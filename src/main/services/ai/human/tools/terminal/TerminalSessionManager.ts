import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { AiRuntimePlatform } from '../../../types'
import { buildTerminalEnvironment } from './environment/TerminalEnvironment'
import { getTerminalPlatformAdapter, type TerminalPlatformAdapter } from './platform'
import { TerminalProtocol, type TerminalProtocolEvent } from './protocol/TerminalProtocol'
import { isTerminalTerminationCommand } from './commandPolicy'
import {
  TERMINAL_MAX_CONCURRENT_SESSIONS,
  TERMINAL_READ_MAX_CHARS,
  TERMINAL_RETAINED_SCROLLBACK_CHARS
} from './terminalConstants'

export type TerminalSessionStatus = 'idle' | 'running' | 'stopping' | 'closed'
export type TerminalCommandReturnReason =
  | 'command_completed'
  | 'command_still_running'
  | 'command_stopped'
  | 'terminal_closed'

export type TerminalSessionSnapshot = {
  terminalId: string
  status: TerminalSessionStatus
  currentTerminalPath: string
  currentCommand: string | null
  startedAt: number | null
}

export type TerminalCommandResult = {
  terminalId: string
  commandId: string
  terminalStatus: TerminalSessionStatus
  returnReason: TerminalCommandReturnReason
  currentTerminalPath: string
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
  exitCode: number | null
}

export type TerminalReadResult = {
  terminalId: string
  terminalStatus: TerminalSessionStatus
  currentTerminalPath: string
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
  exitCode: number | null
}

export type TerminalStopResult = {
  terminalId: string
  terminalStatus: TerminalSessionStatus
  currentTerminalPath: string
  stopped: boolean
  forced: boolean
}

type ActiveCommand = {
  commandId: string
  command: string
  runId: string
  startedAt: number
  outputStartCursor: number
  commandFilePath: string
  exitCode: number | null
  returnReason?: TerminalCommandReturnReason
  completion: Promise<void>
  complete: () => void
}

type ManagedTerminalSession = {
  terminalId: string
  chatSessionId: string
  workspaceId: string
  runtimeDirectory: string
  adapter: TerminalPlatformAdapter
  protocol: TerminalProtocol
  process: IPty
  status: TerminalSessionStatus
  currentTerminalPath: string
  currentCommand: ActiveCommand | null
  lastExitCode: number | null
  output: string
  outputBaseCursor: number
  outputCursor: number
  ready: Promise<void>
  markReady: () => void
  exited: Promise<void>
  markExited: () => void
  createdAt: number
}

export type TerminalSessionManagerOptions = {
  yieldMs?: number
  stopGraceMs?: number
  retainedScrollbackChars?: number
  readMaxChars?: number
  maxConcurrentSessions?: number
  environment?: Record<string, string>
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export const stripTerminalControlText = (value: string): string =>
  value
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        if (parts[index]!.length > 0) return parts[index]!
      }
      return ''
    })
    .join('\n')

const createDeferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const decodeCwd = (encoded: string): string | null => {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim()
    return decoded || null
  } catch {
    return null
  }
}

const isSessionClosed = (session: ManagedTerminalSession): boolean => session.status === 'closed'

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly completedCommandExitCodes = new Map<string, number>()
  private readonly yieldMs: number
  private readonly stopGraceMs: number
  private readonly retainedScrollbackChars: number
  private readonly readMaxChars: number
  private readonly maxConcurrentSessions: number
  private readonly environment?: Record<string, string>

  public constructor(options: TerminalSessionManagerOptions = {}) {
    this.yieldMs = Math.max(50, Number(options.yieldMs || 8000))
    this.stopGraceMs = Math.max(50, Number(options.stopGraceMs || 2000))
    this.retainedScrollbackChars = Math.max(
      1024,
      Number(options.retainedScrollbackChars || TERMINAL_RETAINED_SCROLLBACK_CHARS)
    )
    this.readMaxChars = Math.max(1, Number(options.readMaxChars || TERMINAL_READ_MAX_CHARS))
    this.maxConcurrentSessions = Math.max(
      1,
      Number(options.maxConcurrentSessions || TERMINAL_MAX_CONCURRENT_SESSIONS)
    )
    this.environment = options.environment
  }

  public list(input: { chatSessionId: string; workspaceId?: string }): TerminalSessionSnapshot[] {
    return Array.from(this.sessions.values())
      .filter(
        (session) =>
          session.chatSessionId === input.chatSessionId &&
          (!input.workspaceId || session.workspaceId === input.workspaceId) &&
          session.status !== 'closed'
      )
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((session) => ({
        terminalId: session.terminalId,
        status: session.status,
        currentTerminalPath: session.currentTerminalPath,
        currentCommand: session.currentCommand?.command || null,
        startedAt: session.currentCommand?.startedAt || null
      }))
  }

  public async run(input: {
    chatSessionId: string
    workspaceId: string
    workspaceRootPath: string
    environment?: Record<string, string>
    platform: AiRuntimePlatform
    runId: string
    command: string
  }): Promise<TerminalCommandResult> {
    const session = await this.createSession({
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      workspaceRootPath: input.workspaceRootPath,
      environment: input.environment,
      platform: input.platform,
      allowConcurrentOverLimit: isTerminalTerminationCommand(input.command)
    })

    const leadingCwd = await session.adapter.resolveCommandCwd({
      command: input.command,
      currentPath: session.currentTerminalPath
    })
    if (leadingCwd) session.currentTerminalPath = leadingCwd

    const deferred = createDeferred()
    const commandId = randomUUID()
    const commandFilePath = path.join(session.runtimeDirectory, `${commandId}.command`)
    await writeFile(commandFilePath, input.command, { encoding: 'utf8', mode: 0o600 })
    const commandState: ActiveCommand = {
      commandId,
      command: input.command,
      runId: input.runId,
      startedAt: Date.now(),
      outputStartCursor: session.outputCursor,
      commandFilePath,
      exitCode: null,
      completion: deferred.promise,
      complete: deferred.resolve
    }
    session.currentCommand = commandState
    session.status = 'running'
    try {
      session.process.write(
        `${session.adapter.buildCommandEnvelope(
          commandId,
          commandFilePath
        )}${session.adapter.shell.lineEnding}`
      )
    } catch (error) {
      session.currentCommand = null
      session.status = 'idle'
      await unlink(commandFilePath).catch(() => undefined)
      throw error
    }

    await Promise.race([
      commandState.completion,
      new Promise<void>((resolve) => setTimeout(resolve, this.yieldMs))
    ])

    const completed = commandState.returnReason !== undefined
    const commandOutput = this.readOutput(session, commandState.outputStartCursor)
    const result: TerminalCommandResult = {
      terminalId: session.terminalId,
      commandId,
      terminalStatus: session.status,
      returnReason: completed
        ? commandState.returnReason || 'command_completed'
        : 'command_still_running',
      currentTerminalPath: session.currentTerminalPath,
      output: commandOutput.output,
      readEndPosition: commandOutput.readEndPosition,
      hasMoreOutput: commandOutput.hasMoreOutput,
      exitCode: completed ? commandState.exitCode : null
    }
    if (completed && !commandOutput.hasMoreOutput) {
      await this.closeSession(session)
    }
    return result
  }

  public async read(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
    readEndPosition?: number
  }): Promise<TerminalReadResult> {
    const session = this.requireSession(input)
    const result = this.readOutput(session, input.readEndPosition)
    const output: TerminalReadResult = {
      terminalId: session.terminalId,
      terminalStatus: session.status,
      currentTerminalPath: session.currentTerminalPath,
      output: result.output,
      readEndPosition: result.readEndPosition,
      hasMoreOutput: result.hasMoreOutput,
      exitCode: session.status === 'running' ? null : session.lastExitCode
    }
    if (session.status === 'idle' && !result.hasMoreOutput) {
      await this.closeSession(session)
    }
    return output
  }

  public async waitForCommand(input: {
    terminalId: string
    commandId: string
    chatSessionId: string
    workspaceId: string
  }): Promise<number> {
    const completed = this.completedCommandExitCodes.get(input.commandId)
    if (typeof completed === 'number') return completed
    const session = this.requireSession(input)
    const command = session.currentCommand
    if (!command || command.commandId !== input.commandId) {
      return session.lastExitCode ?? 1
    }
    await command.completion
    const exitCode = command.exitCode ?? session.lastExitCode ?? 1
    return exitCode
  }

  public async stop(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
    closeTerminal?: boolean
  }): Promise<TerminalStopResult> {
    const session = this.requireSession(input)
    let stopped = false
    let forced = false
    if (session.status === 'running' && session.currentCommand) {
      stopped = true
      session.status = 'stopping'
      const command = session.currentCommand
      session.process.write('\u0003')
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      if (!command.returnReason) {
        session.process.write(
          `${session.adapter.buildStopProbe(command.commandId)}${session.adapter.shell.lineEnding}`
        )
      }
      await Promise.race([
        command.completion,
        new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
      ])
      if (!command.returnReason) {
        forced = true
        await this.forceTerminateSession(session)
        await Promise.race([
          command.completion,
          new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
        ])
        if (!isSessionClosed(session)) {
          session.status = 'closed'
          this.sessions.delete(session.terminalId)
        }
      }
    }

    if (input.closeTerminal && session.status !== 'closed') {
      await this.closeSession(session)
    } else if (input.closeTerminal) {
      this.sessions.delete(session.terminalId)
      await rm(session.runtimeDirectory, { recursive: true, force: true })
    } else if (session.status === 'stopping') {
      session.status = session.currentCommand ? 'running' : 'idle'
    }

    return {
      terminalId: session.terminalId,
      terminalStatus: session.status,
      currentTerminalPath: session.currentTerminalPath,
      stopped,
      forced
    }
  }

  public async closeByChatSession(chatSessionId: string): Promise<void> {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.chatSessionId === chatSessionId
    )
    await Promise.all(sessions.map(async (session) => await this.closeSession(session)))
  }

  public async stopByRun(runId: string): Promise<void> {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.currentCommand?.runId === runId
    )
    await Promise.all(
      sessions.map((session) =>
        this.stop({
          terminalId: session.terminalId,
          chatSessionId: session.chatSessionId,
          workspaceId: session.workspaceId
        }).catch(() => undefined)
      )
    )
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values()).map(async (session) => await this.closeSession(session))
    )
    this.completedCommandExitCodes.clear()
  }

  private async createSession(input: {
    chatSessionId: string
    workspaceId: string
    workspaceRootPath: string
    environment?: Record<string, string>
    platform: AiRuntimePlatform
    allowConcurrentOverLimit?: boolean
  }): Promise<ManagedTerminalSession> {
    if (!input.allowConcurrentOverLimit) {
      const activeCount = Array.from(this.sessions.values()).filter(
        (session) =>
          session.chatSessionId === input.chatSessionId &&
          (session.status === 'running' || session.status === 'stopping')
      ).length
      if (activeCount >= this.maxConcurrentSessions) {
        throw new Error('terminal_session_limit_reached')
      }
    }
    const rootPath = path.resolve(input.workspaceRootPath)
    const ready = createDeferred()
    const exited = createDeferred()
    const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-terminal-runtime-'))
    await chmod(runtimeDirectory, 0o700)
    const adapter = getTerminalPlatformAdapter(input.platform)
    const protocol = new TerminalProtocol(randomUUID())
    let terminalProcess: IPty
    try {
      terminalProcess = pty.spawn(adapter.shell.executable, adapter.shell.args, {
        name: 'xterm-256color',
        cols: 1000,
        rows: 30,
        cwd: rootPath,
        encoding: 'utf8',
        env: buildTerminalEnvironment({
          platform: input.platform,
          managerEnvironment: this.environment,
          sessionEnvironment: input.environment
        })
      })
    } catch (error) {
      await rm(runtimeDirectory, { recursive: true, force: true })
      throw error
    }
    const session: ManagedTerminalSession = {
      terminalId: randomUUID(),
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      runtimeDirectory,
      adapter,
      protocol,
      process: terminalProcess,
      status: 'idle',
      currentTerminalPath: rootPath,
      currentCommand: null,
      lastExitCode: null,
      output: '',
      outputBaseCursor: 0,
      outputCursor: 0,
      ready: ready.promise,
      markReady: ready.resolve,
      exited: exited.promise,
      markExited: exited.resolve,
      createdAt: Date.now()
    }
    this.sessions.set(session.terminalId, session)
    terminalProcess.onData((data) => this.consumeProtocolData(session, data))
    terminalProcess.onExit(({ exitCode }) => this.finalizeSessionExit(session, exitCode))
    try {
      terminalProcess.write(adapter.buildBootstrapCommand(protocol))
      await Promise.race([
        session.ready,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('terminal_start_timeout')), 10_000)
        )
      ])
    } catch (error) {
      await this.closeSession(session)
      throw error
    }
    return session
  }

  private async closeSession(session: ManagedTerminalSession): Promise<void> {
    if (session.status === 'closed') {
      this.sessions.delete(session.terminalId)
      await rm(session.runtimeDirectory, { recursive: true, force: true })
      return
    }

    if (!session.currentCommand && session.status === 'idle') {
      try {
        session.process.write(session.adapter.buildExitCommand())
        await Promise.race([
          session.exited,
          new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
        ])
      } catch {
        // Fall through to forced process termination.
      }
    }

    if (!isSessionClosed(session)) {
      await this.forceTerminateSession(session)
      await Promise.race([
        session.exited,
        new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
      ])
    }

    session.status = 'closed'
    this.sessions.delete(session.terminalId)
    await rm(session.runtimeDirectory, { recursive: true, force: true })
  }

  private async forceTerminateSession(session: ManagedTerminalSession): Promise<void> {
    await session.adapter.forceTerminate(session.process)
    await Promise.race([
      session.exited,
      new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
    ])
    if (!isSessionClosed(session)) {
      this.finalizeSessionExit(session, session.currentCommand ? 130 : 1)
    }
  }

  private finalizeSessionExit(session: ManagedTerminalSession, exitCode: number): void {
    if (isSessionClosed(session)) return
    session.status = 'closed'
    session.lastExitCode = exitCode
    if (session.currentCommand) {
      void unlink(session.currentCommand.commandFilePath).catch(() => undefined)
      session.currentCommand.exitCode = exitCode
      session.currentCommand.returnReason = 'terminal_closed'
      this.recordCompletedCommand(session.currentCommand.commandId, exitCode)
      session.currentCommand.complete()
      session.currentCommand = null
    }
    session.markReady()
    session.markExited()
  }

  private requireSession(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
  }): ManagedTerminalSession {
    const session = this.sessions.get(input.terminalId)
    if (
      !session ||
      session.chatSessionId !== input.chatSessionId ||
      session.workspaceId !== input.workspaceId
    ) {
      throw new Error('terminal_not_found')
    }
    return session
  }

  private consumeProtocolData(session: ManagedTerminalSession, data: string): void {
    for (const event of session.protocol.consume(data)) this.consumeProtocolEvent(session, event)
  }

  private consumeProtocolEvent(
    session: ManagedTerminalSession,
    event: TerminalProtocolEvent
  ): void {
    if (event.type === 'output') {
      if (session.currentCommand) this.appendOutput(session, event.data)
      return
    }
    if (event.type === 'ready') {
      session.output = ''
      session.outputBaseCursor = 0
      session.outputCursor = 0
      session.markReady()
      return
    }
    if (event.type === 'cwd') {
      this.updateCurrentPath(session, event.encodedCwd)
      return
    }
    if (event.type === 'start') {
      if (session.currentCommand?.commandId === event.commandId) {
        session.currentCommand.outputStartCursor = session.outputCursor
      }
      return
    }

    const command = session.currentCommand
    if (!command || command.commandId !== event.commandId) return
    this.updateCurrentPath(session, event.encodedCwd)
    const exitCode = Number(event.exitCodeText)
    command.exitCode = Number.isFinite(exitCode) ? exitCode : 1
    command.returnReason = session.status === 'stopping' ? 'command_stopped' : 'command_completed'
    session.lastExitCode = command.exitCode
    void unlink(command.commandFilePath).catch(() => undefined)
    this.recordCompletedCommand(command.commandId, command.exitCode)
    session.status = 'idle'
    session.currentCommand = null
    command.complete()
  }

  private updateCurrentPath(session: ManagedTerminalSession, encodedCwd: string): void {
    const nextPath = decodeCwd(encodedCwd)
    if (nextPath && path.isAbsolute(nextPath)) {
      session.currentTerminalPath = path.resolve(nextPath)
    }
  }

  private appendOutput(session: ManagedTerminalSession, raw: string): void {
    const value = stripTerminalControlText(raw)
    if (!value) return
    session.output += value
    session.outputCursor += value.length
    if (session.output.length > this.retainedScrollbackChars) {
      const trimCount = session.output.length - this.retainedScrollbackChars
      session.output = session.output.slice(trimCount)
      session.outputBaseCursor += trimCount
    }
  }

  private recordCompletedCommand(commandId: string, exitCode: number): void {
    this.completedCommandExitCodes.set(commandId, exitCode)
    if (this.completedCommandExitCodes.size <= 1000) return
    const oldest = this.completedCommandExitCodes.keys().next().value
    if (oldest) this.completedCommandExitCodes.delete(oldest)
  }

  // 从请求游标读到当前末尾，但单次最多返回 readMaxChars 个字符；
  // readEndPosition 是本次返回内容之后的下一个位置，模型原样传回即可续读；
  // hasMoreOutput 表示缓冲里是否还有更新的输出未读完。
  private readOutput(
    session: ManagedTerminalSession,
    requestedCursor?: number
  ): { output: string; readEndPosition: number; hasMoreOutput: boolean } {
    const watermark = session.outputCursor
    const start = Math.max(
      session.outputBaseCursor,
      Math.min(watermark, Number(requestedCursor ?? session.outputBaseCursor))
    )
    const end = Math.min(start + this.readMaxChars, watermark)
    const offset = start - session.outputBaseCursor
    return {
      output: session.output.slice(offset, offset + (end - start)),
      readEndPosition: end,
      hasMoreOutput: end < watermark
    }
  }
}

export const terminalSessionManager = new TerminalSessionManager()

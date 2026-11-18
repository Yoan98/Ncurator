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
  TERMINAL_DEFAULT_WATCH_SECONDS,
  TERMINAL_MAX_CONCURRENT_SESSIONS,
  TERMINAL_MAX_SESSIONS_PER_CHAT,
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
  commandId: string | null
  exitCode: number | null
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
  lastUsedAt: number
  output: string
  outputBaseCursor: number
  outputCursor: number
  ready: Promise<void>
  markReady: () => void
  exited: Promise<void>
  markExited: () => void
  createdAt: number
}

export type CompletedCommand = {
  exitCode: number
  returnReason: TerminalCommandReturnReason
}

export type TerminalSessionManagerOptions = {
  yieldMs?: number
  stopGraceMs?: number
  retainedScrollbackChars?: number
  readMaxChars?: number
  maxConcurrentSessions?: number
  maxSessionsPerChat?: number
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

// 与超时竞争，先到者生效；无论谁先到都清掉计时器，避免长等待时长在进程里留挂起的定时器。
const raceWithTimeout = async <T>(input: {
  promise: Promise<T>
  timeoutMs: number
  onTimeout: () => T
}): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          try {
            resolve(input.onTimeout())
          } catch (error) {
            reject(error)
          }
        }, input.timeoutMs)
      })
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
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

const MIN_WATCH_MS = 50

const resolveWatchMs = (maxWaitSeconds: number | undefined, fallbackMs: number): number => {
  if (typeof maxWaitSeconds !== 'number' || !Number.isFinite(maxWaitSeconds)) return fallbackMs
  return Math.max(MIN_WATCH_MS, Math.trunc(maxWaitSeconds) * 1000)
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly completedCommands = new Map<string, CompletedCommand>()
  // 已通过并发检查但还没挂上 currentCommand 的会话数，按 runId 记账；防止并行 run 调用同时穿透上限。
  private readonly pendingRunSlots = new Map<string, number>()
  private creationQueue: Promise<void> = Promise.resolve()
  private readonly yieldMs: number
  private readonly stopGraceMs: number
  private readonly retainedScrollbackChars: number
  private readonly readMaxChars: number
  private readonly maxConcurrentSessions: number
  private readonly maxSessionsPerChat: number
  private readonly environment?: Record<string, string>

  public constructor(options: TerminalSessionManagerOptions = {}) {
    this.yieldMs = Math.max(
      MIN_WATCH_MS,
      Number(options.yieldMs || TERMINAL_DEFAULT_WATCH_SECONDS * 1000)
    )
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
    this.maxSessionsPerChat = Math.max(
      1,
      Number(options.maxSessionsPerChat || TERMINAL_MAX_SESSIONS_PER_CHAT)
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
    maxWaitSeconds?: number
  }): Promise<TerminalCommandResult> {
    const allowConcurrentOverLimit = isTerminalTerminationCommand(input.command)
    const releaseRunSlot = this.acquireRunSlot(input, allowConcurrentOverLimit)
    let session: ManagedTerminalSession | null = null
    try {
      session = await this.createSession({
        chatSessionId: input.chatSessionId,
        workspaceId: input.workspaceId,
        workspaceRootPath: input.workspaceRootPath,
        environment: input.environment,
        platform: input.platform,
        runId: input.runId
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
      session.lastUsedAt = commandState.startedAt
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
      // 命令已挂上会话，后续并发额度由会话本身计数，释放预占名额。
      releaseRunSlot()

      await raceWithTimeout({
        promise: commandState.completion,
        timeoutMs: resolveWatchMs(input.maxWaitSeconds, this.yieldMs),
        onTimeout: () => undefined
      })

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
    } catch (error) {
      releaseRunSlot()
      if (session && !session.currentCommand && session.status !== 'closed') {
        await this.closeSession(session).catch(() => undefined)
      }
      throw error
    }
  }

  public async read(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
    readEndPosition?: number
  }): Promise<TerminalReadResult> {
    const session = this.requireSession(input)
    session.lastUsedAt = Date.now()
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
  }): Promise<CompletedCommand> {
    const completed = this.completedCommands.get(input.commandId)
    if (completed) return completed
    const session = this.requireSession(input)
    const command = session.currentCommand
    if (!command || command.commandId !== input.commandId) {
      return { exitCode: session.lastExitCode ?? 1, returnReason: 'terminal_closed' }
    }
    await command.completion
    return {
      exitCode: command.exitCode ?? session.lastExitCode ?? 1,
      returnReason: command.returnReason ?? 'command_completed'
    }
  }

  public async stop(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
    closeTerminal?: boolean
  }): Promise<TerminalStopResult> {
    const session = this.requireSession(input)
    const command = session.currentCommand
    let stopped = false
    let forced = false
    if (session.status === 'running' && command) {
      stopped = true
      session.status = 'stopping'
      session.process.write('\u0003')
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      if (!command.returnReason) {
        session.process.write(
          `${session.adapter.buildStopProbe(command.commandId)}${session.adapter.shell.lineEnding}`
        )
      }
      await raceWithTimeout({
        promise: command.completion,
        timeoutMs: this.stopGraceMs,
        onTimeout: () => undefined
      })
      if (!command.returnReason) {
        forced = true
        await this.forceTerminateSession(session)
        await raceWithTimeout({
          promise: command.completion,
          timeoutMs: this.stopGraceMs,
          onTimeout: () => undefined
        })
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
      forced,
      commandId: command?.commandId ?? null,
      exitCode: command?.exitCode ?? null
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
          workspaceId: session.workspaceId,
          closeTerminal: true
        }).catch(() => undefined)
      )
    )
  }

  public async dispose(): Promise<void> {
    await this.creationQueue
    await Promise.all(
      Array.from(this.sessions.values()).map(async (session) => await this.closeSession(session))
    )
    this.completedCommands.clear()
    this.pendingRunSlots.clear()
  }

  private async createSession(input: {
    chatSessionId: string
    workspaceId: string
    workspaceRootPath: string
    environment?: Record<string, string>
    platform: AiRuntimePlatform
    runId: string
  }): Promise<ManagedTerminalSession> {
    // PTY 创建是异步的；串行化“回收 + 创建”避免并行调用同时穿透总量上限。
    return await this.withCreationLock(async () => {
      await this.reclaimChatSessions({
        chatSessionId: input.chatSessionId,
        runId: input.runId,
        incoming: 1
      })
      return await this.spawnSession(input)
    })
  }

  private async spawnSession(input: {
    chatSessionId: string
    workspaceId: string
    workspaceRootPath: string
    environment?: Record<string, string>
    platform: AiRuntimePlatform
  }): Promise<ManagedTerminalSession> {
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
    const createdAt = Date.now()
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
      lastUsedAt: createdAt,
      output: '',
      outputBaseCursor: 0,
      outputCursor: 0,
      ready: ready.promise,
      markReady: ready.resolve,
      exited: exited.promise,
      markExited: exited.resolve,
      createdAt
    }
    this.sessions.set(session.terminalId, session)
    terminalProcess.onData((data) => this.consumeProtocolData(session, data))
    terminalProcess.onExit(({ exitCode }) => this.finalizeSessionExit(session, exitCode))
    try {
      terminalProcess.write(adapter.buildBootstrapCommand(protocol))
      await raceWithTimeout({
        promise: session.ready,
        timeoutMs: 10_000,
        onTimeout: () => {
          throw new Error('terminal_start_timeout')
        }
      })
    } catch (error) {
      await this.closeSession(session)
      throw error
    }
    return session
  }

  private async withCreationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.creationQueue
    let release: () => void = () => undefined
    this.creationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }

  private async reclaimChatSessions(input: {
    chatSessionId: string
    runId: string
    incoming: number
  }): Promise<void> {
    const needsReclaim = (): boolean =>
      this.chatSessions(input.chatSessionId).length + input.incoming > this.maxSessionsPerChat
    if (!needsReclaim()) return
    const candidates = this.chatSessions(input.chatSessionId)
      .filter((session) => session.currentCommand?.runId !== input.runId)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
    for (const session of candidates) {
      if (!needsReclaim()) return
      try {
        await this.stop({
          terminalId: session.terminalId,
          chatSessionId: session.chatSessionId,
          workspaceId: session.workspaceId,
          closeTerminal: true
        })
      } catch {
        // 会话可能在回收前已自行结束，继续尝试下一个候选。
      }
    }
    if (needsReclaim()) throw new Error('terminal_session_limit_reached')
  }

  private acquireRunSlot(
    input: { chatSessionId: string; runId: string },
    allowConcurrentOverLimit: boolean
  ): () => void {
    if (allowConcurrentOverLimit) return () => undefined
    const active = this.countRunSessions(input) + (this.pendingRunSlots.get(input.runId) ?? 0)
    if (active >= this.maxConcurrentSessions) throw new Error('terminal_session_limit_reached')
    this.pendingRunSlots.set(input.runId, (this.pendingRunSlots.get(input.runId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.pendingRunSlots.get(input.runId) ?? 1) - 1
      if (remaining <= 0) this.pendingRunSlots.delete(input.runId)
      else this.pendingRunSlots.set(input.runId, remaining)
    }
  }

  private countRunSessions(input: { chatSessionId: string; runId: string }): number {
    return this.chatSessions(input.chatSessionId).filter(
      (session) =>
        session.currentCommand?.runId === input.runId &&
        (session.status === 'running' || session.status === 'stopping')
    ).length
  }

  private chatSessions(chatSessionId: string): ManagedTerminalSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.chatSessionId === chatSessionId
    )
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
        await raceWithTimeout({
          promise: session.exited,
          timeoutMs: this.stopGraceMs,
          onTimeout: () => undefined
        })
      } catch {
        // Fall through to forced process termination.
      }
    }

    if (!isSessionClosed(session)) {
      await this.forceTerminateSession(session)
      await raceWithTimeout({
        promise: session.exited,
        timeoutMs: this.stopGraceMs,
        onTimeout: () => undefined
      })
    }

    session.status = 'closed'
    this.sessions.delete(session.terminalId)
    await rm(session.runtimeDirectory, { recursive: true, force: true })
  }

  private async forceTerminateSession(session: ManagedTerminalSession): Promise<void> {
    await session.adapter.forceTerminate(session.process)
    await raceWithTimeout({
      promise: session.exited,
      timeoutMs: this.stopGraceMs,
      onTimeout: () => undefined
    })
    if (!isSessionClosed(session)) {
      this.finalizeSessionExit(session, session.currentCommand ? 130 : 1)
    }
  }

  private finalizeSessionExit(session: ManagedTerminalSession, exitCode: number): void {
    if (isSessionClosed(session)) return
    const wasStopping = session.status === 'stopping'
    session.status = 'closed'
    session.lastExitCode = exitCode
    if (session.currentCommand) {
      void unlink(session.currentCommand.commandFilePath).catch(() => undefined)
      session.currentCommand.exitCode = exitCode
      session.currentCommand.returnReason = wasStopping ? 'command_stopped' : 'terminal_closed'
      this.recordCompletedCommand(
        session.currentCommand.commandId,
        exitCode,
        session.currentCommand.returnReason
      )
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
    session.lastUsedAt = Date.now()
    void unlink(command.commandFilePath).catch(() => undefined)
    this.recordCompletedCommand(command.commandId, command.exitCode, command.returnReason)
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

  private recordCompletedCommand(
    commandId: string,
    exitCode: number,
    returnReason: TerminalCommandReturnReason
  ): void {
    this.completedCommands.set(commandId, { exitCode, returnReason })
    if (this.completedCommands.size <= 1000) return
    const oldest = this.completedCommands.keys().next().value
    if (oldest) this.completedCommands.delete(oldest)
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

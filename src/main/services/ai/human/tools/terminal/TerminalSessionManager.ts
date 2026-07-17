import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { AiRuntimePlatform } from '../../../types'
import { isPathInsideAnyRoot } from './commandPolicy'

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
  outputCursor: number
  exitCode: number | null
}

export type TerminalReadResult = {
  terminalId: string
  terminalStatus: TerminalSessionStatus
  currentTerminalPath: string
  output: string
  outputCursor: number
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
  exitCode: number | null
  returnReason?: TerminalCommandReturnReason
  completion: Promise<void>
  complete: () => void
}

type ManagedTerminalSession = {
  terminalId: string
  chatSessionId: string
  workspaceId: string
  workspaceRootPath: string
  allowedRootPaths: string[]
  platform: AiRuntimePlatform
  process: IPty
  status: TerminalSessionStatus
  currentTerminalPath: string
  currentCommand: ActiveCommand | null
  lastExitCode: number | null
  output: string
  outputBaseCursor: number
  outputCursor: number
  protocolBuffer: string
  readyMarkerCount: number
  ready: Promise<void>
  markReady: () => void
  createdAt: number
  lastActiveAt: number
}

export type TerminalSessionManagerOptions = {
  yieldMs?: number
  stopGraceMs?: number
  maxOutputChars?: number
  maxSessionsPerChat?: number
  idleTtlMs?: number
  runningTtlMs?: number
  environment?: Record<string, string>
}

const READY_MARKER = '__NCURATOR_READY__'
const CWD_PREFIX = '__NCURATOR_CWD:'
const START_PREFIX = '__NCURATOR_START:'
const DONE_PREFIX = '__NCURATOR_DONE:'
const DONE_SUFFIX = '__'
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

const stripTerminalControlText = (value: string): string =>
  value.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const createDeferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const encodePowerShellCommand = (command: string): string =>
  Buffer.from(command, 'utf16le').toString('base64')

const buildShellStart = (platform: AiRuntimePlatform) =>
  platform === 'windows'
    ? { executable: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] }
    : { executable: '/bin/zsh', args: ['-f'] }

const buildTerminalEnv = (overrides?: Record<string, string>): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  ),
  ...overrides,
  TERM: 'xterm-256color',
  PS1: '',
  PROMPT: '',
  RPROMPT: ''
})

const buildReadyCommand = (platform: AiRuntimePlatform): string =>
  platform === 'windows'
    ? [
        `function global:Set-Location { param([Parameter(Position=0)][string]$Path) Microsoft.PowerShell.Management\\Set-Location -Path $Path; $__cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)); Write-Output ('__NCURATOR_' + 'CWD:' + $__cwd + '__') }`,
        `Write-Output ('__NCURATOR_' + 'READY__')`
      ].join('; ') + '\r'
    : [
        'stty -echo',
        `function chpwd() { local __ncurator_cwd=$(pwd | base64 | tr -d '\\n'); printf '%sCWD:%s__\\n' '__NCURATOR_' "$__ncurator_cwd"; }`,
        `printf '%s%s\\n' '__NCURATOR_' 'READY__'`
      ].join('; ') + '\n'

const buildStopProbe = (input: { platform: AiRuntimePlatform; commandId: string }): string => {
  if (input.platform === 'windows') {
    return [
      `$__ncurator_cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))`,
      `$__ncurator_marker = '__NCURATOR_' + "DONE:${input.commandId}:130:$($__ncurator_cwd)__"`,
      'Write-Output $__ncurator_marker'
    ].join('\r')
  }
  return [
    "__ncurator_cwd=$(pwd | base64 | tr -d '\\n')",
    `printf '%sDONE:${input.commandId}:130:%s__\\n' '__NCURATOR_' "$__ncurator_cwd"`
  ].join('\n')
}

const buildCommandEnvelope = (input: {
  platform: AiRuntimePlatform
  commandId: string
  command: string
}): string => {
  if (input.platform === 'windows') {
    const encoded = encodePowerShellCommand(input.command)
    return [
      `$__ncurator_command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))`,
      `$__ncurator_start = '__NCURATOR_' + 'START:${input.commandId}__'`,
      'Write-Output $__ncurator_start',
      `Invoke-Expression $__ncurator_command`,
      `$__ncurator_exit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }`,
      `$__ncurator_cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))`,
      `$__ncurator_marker = '__NCURATOR_' + "DONE:${input.commandId}:$($__ncurator_exit):$($__ncurator_cwd)__"`,
      'Write-Output $__ncurator_marker'
    ].join('; ')
  }

  const encoded = Buffer.from(input.command, 'utf8').toString('base64')
  return [
    `printf '%sSTART:${input.commandId}__\\n' '__NCURATOR_'`,
    `eval "$(printf '%s' '${encoded}' | base64 -D)"`,
    '__ncurator_exit=$?',
    "__ncurator_cwd=$(pwd | base64 | tr -d '\\n')",
    `printf '%sDONE:${input.commandId}:%s:%s__\\n' '__NCURATOR_' "$__ncurator_exit" "$__ncurator_cwd"`
  ].join('; ')
}

const decodeCwd = (encoded: string): string | null => {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim()
    return decoded || null
  } catch {
    return null
  }
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly completedCommandExitCodes = new Map<string, number>()
  private readonly yieldMs: number
  private readonly stopGraceMs: number
  private readonly maxOutputChars: number
  private readonly maxSessionsPerChat: number
  private readonly idleTtlMs: number
  private readonly runningTtlMs: number
  private readonly environment?: Record<string, string>
  private readonly cleanupTimer: ReturnType<typeof setInterval>

  public constructor(options: TerminalSessionManagerOptions = {}) {
    this.yieldMs = Math.max(50, Number(options.yieldMs || 8000))
    this.stopGraceMs = Math.max(50, Number(options.stopGraceMs || 2000))
    this.maxOutputChars = Math.max(1024, Number(options.maxOutputChars || 1_000_000))
    this.maxSessionsPerChat = Math.max(1, Number(options.maxSessionsPerChat || 3))
    this.idleTtlMs = Math.max(1000, Number(options.idleTtlMs || 30 * 60 * 1000))
    this.runningTtlMs = Math.max(1000, Number(options.runningTtlMs || 2 * 60 * 60 * 1000))
    this.environment = options.environment
    this.cleanupTimer = setInterval(() => this.pruneExpiredSessions(), 60_000)
    this.cleanupTimer.unref?.()
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
    userRuntimeRootPath?: string
    platform: AiRuntimePlatform
    runId: string
    command: string
    terminalId?: string
  }): Promise<TerminalCommandResult> {
    const session = input.terminalId
      ? this.requireSession({
          terminalId: input.terminalId,
          chatSessionId: input.chatSessionId,
          workspaceId: input.workspaceId
        })
      : await this.createSession(input)

    await session.ready
    if (session.status === 'running' || session.status === 'stopping') {
      throw new Error('terminal_busy')
    }
    if (session.status === 'closed') throw new Error('terminal_closed')

    const deferred = createDeferred()
    const commandId = randomUUID()
    const commandState: ActiveCommand = {
      commandId,
      command: input.command,
      runId: input.runId,
      startedAt: Date.now(),
      outputStartCursor: session.outputCursor,
      exitCode: null,
      completion: deferred.promise,
      complete: deferred.resolve
    }
    session.currentCommand = commandState
    session.status = 'running'
    session.lastActiveAt = Date.now()
    session.process.write(
      `${buildCommandEnvelope({
        platform: session.platform,
        commandId,
        command: input.command
      })}${session.platform === 'windows' ? '\r' : '\n'}`
    )

    await Promise.race([
      commandState.completion,
      new Promise<void>((resolve) => setTimeout(resolve, this.yieldMs))
    ])

    const completed = commandState.returnReason !== undefined
    return {
      terminalId: session.terminalId,
      commandId,
      terminalStatus: session.status,
      returnReason: completed
        ? commandState.returnReason || 'command_completed'
        : 'command_still_running',
      currentTerminalPath: session.currentTerminalPath,
      output: this.readOutput(session, commandState.outputStartCursor).output,
      outputCursor: session.outputCursor,
      exitCode: completed ? commandState.exitCode : null
    }
  }

  public read(input: {
    terminalId: string
    chatSessionId: string
    workspaceId: string
    outputCursor?: number
  }): TerminalReadResult {
    const session = this.requireSession(input)
    const result = this.readOutput(session, input.outputCursor)
    session.lastActiveAt = Date.now()
    return {
      terminalId: session.terminalId,
      terminalStatus: session.status,
      currentTerminalPath: session.currentTerminalPath,
      output: result.output,
      outputCursor: result.outputCursor,
      exitCode: session.status === 'running' ? null : session.lastExitCode
    }
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
    return command.exitCode ?? session.lastExitCode ?? 1
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
      session.process.write(
        `${buildStopProbe({
          platform: session.platform,
          commandId: command.commandId
        })}${session.platform === 'windows' ? '\r' : '\n'}`
      )
      await Promise.race([
        command.completion,
        new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
      ])
      if (!command.returnReason) {
        forced = true
        session.process.kill()
        await Promise.race([
          command.completion,
          new Promise<void>((resolve) => setTimeout(resolve, this.stopGraceMs))
        ])
      }
    }

    if (input.closeTerminal && session.status !== 'closed') {
      session.process.kill()
      session.status = 'closed'
      this.sessions.delete(session.terminalId)
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
    sessions.forEach((session) => {
      session.process.kill()
      session.status = 'closed'
      this.sessions.delete(session.terminalId)
    })
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
    clearInterval(this.cleanupTimer)
    Array.from(this.sessions.values()).forEach((session) => session.process.kill())
    this.sessions.clear()
    this.completedCommandExitCodes.clear()
  }

  private pruneExpiredSessions(): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      const expired = session.currentCommand
        ? now - session.currentCommand.startedAt >= this.runningTtlMs
        : now - session.lastActiveAt >= this.idleTtlMs
      if (!expired) continue
      session.process.kill()
      session.status = 'closed'
      this.sessions.delete(session.terminalId)
    }
  }

  private async createSession(input: {
    chatSessionId: string
    workspaceId: string
    workspaceRootPath: string
    userRuntimeRootPath?: string
    platform: AiRuntimePlatform
  }): Promise<ManagedTerminalSession> {
    const activeCount = this.list({ chatSessionId: input.chatSessionId }).length
    if (activeCount >= this.maxSessionsPerChat) throw new Error('terminal_session_limit_reached')

    const rootPath = path.resolve(input.workspaceRootPath)
    const allowedRootPaths = Array.from(
      new Set(
        [rootPath, input.userRuntimeRootPath]
          .map((root) => String(root || '').trim())
          .filter(Boolean)
          .map((root) => path.resolve(root))
      )
    )
    const ready = createDeferred()
    const shell = buildShellStart(input.platform)
    const terminalProcess = pty.spawn(shell.executable, shell.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: rootPath,
      env: buildTerminalEnv(this.environment)
    })
    const session: ManagedTerminalSession = {
      terminalId: randomUUID(),
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      workspaceRootPath: rootPath,
      allowedRootPaths,
      platform: input.platform,
      process: terminalProcess,
      status: 'idle',
      currentTerminalPath: rootPath,
      currentCommand: null,
      lastExitCode: null,
      output: '',
      outputBaseCursor: 0,
      outputCursor: 0,
      protocolBuffer: '',
      readyMarkerCount: 0,
      ready: ready.promise,
      markReady: ready.resolve,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    }
    this.sessions.set(session.terminalId, session)
    terminalProcess.onData((data) => this.consumeProtocolData(session, data))
    terminalProcess.onExit(({ exitCode }) => {
      session.status = 'closed'
      session.lastExitCode = exitCode
      if (session.currentCommand) {
        session.currentCommand.exitCode = exitCode
        session.currentCommand.returnReason = 'terminal_closed'
        this.recordCompletedCommand(session.currentCommand.commandId, exitCode)
        session.currentCommand.complete()
        session.currentCommand = null
      }
      session.markReady()
    })
    terminalProcess.write(buildReadyCommand(input.platform))
    await Promise.race([
      session.ready,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('terminal_start_timeout')), 3000)
      )
    ])
    return session
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
    session.protocolBuffer += data
    for (;;) {
      const readyIndex = session.protocolBuffer.indexOf(READY_MARKER)
      const cwdIndex = session.protocolBuffer.indexOf(CWD_PREFIX)
      const startIndex = session.protocolBuffer.indexOf(START_PREFIX)
      const doneIndex = session.protocolBuffer.indexOf(DONE_PREFIX)
      const markerIndexes = [readyIndex, cwdIndex, startIndex, doneIndex].filter(
        (index) => index >= 0
      )
      if (markerIndexes.length === 0) {
        const keepLength = Math.min(
          session.protocolBuffer.length,
          Math.max(
            READY_MARKER.length,
            CWD_PREFIX.length,
            START_PREFIX.length,
            DONE_PREFIX.length
          ) - 1
        )
        const flushLength = session.protocolBuffer.length - keepLength
        if (flushLength > 0) {
          this.appendOutput(session, session.protocolBuffer.slice(0, flushLength))
          session.protocolBuffer = session.protocolBuffer.slice(flushLength)
        }
        return
      }

      const markerIndex = Math.min(...markerIndexes)
      if (markerIndex > 0) {
        this.appendOutput(session, session.protocolBuffer.slice(0, markerIndex))
        session.protocolBuffer = session.protocolBuffer.slice(markerIndex)
      }

      if (session.protocolBuffer.startsWith(READY_MARKER)) {
        session.protocolBuffer = session.protocolBuffer.slice(READY_MARKER.length)
        session.readyMarkerCount += 1
        session.markReady()
        continue
      }

      if (session.protocolBuffer.startsWith(CWD_PREFIX)) {
        const endIndex = session.protocolBuffer.indexOf(DONE_SUFFIX, CWD_PREFIX.length)
        if (endIndex < 0) return
        const encodedCwd = session.protocolBuffer.slice(CWD_PREFIX.length, endIndex)
        session.protocolBuffer = session.protocolBuffer.slice(endIndex + DONE_SUFFIX.length)
        const nextPath = decodeCwd(encodedCwd)
        if (nextPath && isPathInsideAnyRoot(nextPath, session.allowedRootPaths)) {
          session.currentTerminalPath = path.resolve(nextPath)
        }
        continue
      }

      if (session.protocolBuffer.startsWith(START_PREFIX)) {
        const endIndex = session.protocolBuffer.indexOf(DONE_SUFFIX, START_PREFIX.length)
        if (endIndex < 0) return
        const commandId = session.protocolBuffer.slice(START_PREFIX.length, endIndex)
        session.protocolBuffer = session.protocolBuffer.slice(endIndex + DONE_SUFFIX.length)
        if (session.currentCommand?.commandId === commandId) {
          session.currentCommand.outputStartCursor = session.outputCursor
        }
        continue
      }

      const endIndex = session.protocolBuffer.indexOf(DONE_SUFFIX, DONE_PREFIX.length)
      if (endIndex < 0) return
      const marker = session.protocolBuffer.slice(DONE_PREFIX.length, endIndex)
      session.protocolBuffer = session.protocolBuffer.slice(endIndex + DONE_SUFFIX.length)
      const [commandId, exitCodeText, encodedCwd] = marker.split(':')
      const command = session.currentCommand
      if (!command || command.commandId !== commandId) continue

      const nextPath = decodeCwd(encodedCwd || '')
      if (nextPath && isPathInsideAnyRoot(nextPath, session.allowedRootPaths)) {
        session.currentTerminalPath = path.resolve(nextPath)
      }
      const exitCode = Number(exitCodeText)
      command.exitCode = Number.isFinite(exitCode) ? exitCode : 1
      command.returnReason = session.status === 'stopping' ? 'command_stopped' : 'command_completed'
      session.lastExitCode = command.exitCode
      this.recordCompletedCommand(command.commandId, command.exitCode)
      session.status = 'idle'
      session.currentCommand = null
      command.complete()
    }
  }

  private appendOutput(session: ManagedTerminalSession, raw: string): void {
    const value = stripTerminalControlText(raw)
    if (!value) return
    session.output += value
    session.outputCursor += value.length
    if (session.output.length > this.maxOutputChars) {
      const trimCount = session.output.length - this.maxOutputChars
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

  private readOutput(
    session: ManagedTerminalSession,
    requestedCursor?: number
  ): { output: string; outputCursor: number } {
    const cursor = Math.max(
      session.outputBaseCursor,
      Math.min(session.outputCursor, Number(requestedCursor ?? session.outputBaseCursor))
    )
    const offset = cursor - session.outputBaseCursor
    return {
      output: session.output.slice(offset),
      outputCursor: session.outputCursor
    }
  }
}

export const terminalSessionManager = new TerminalSessionManager()

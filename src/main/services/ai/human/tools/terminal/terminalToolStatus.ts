import type { TerminalToolStatus } from './outputTypes'

export const mapTerminalRunStatus = (
  returnReason: string,
  exitCode: number | null
): TerminalToolStatus => {
  if (returnReason === 'command_still_running') return 'running'
  if (returnReason === 'command_stopped') return 'cancelled'
  if (exitCode === 130) return 'cancelled'
  if (exitCode === 0) return 'succeeded'
  return 'failed'
}

export const mapTerminalReadStatus = (
  terminalStatus: string,
  exitCode: number | null,
  hasMoreOutput: boolean
): TerminalToolStatus => {
  if (terminalStatus === 'running' || hasMoreOutput) return 'running'
  if (exitCode === 130) return 'cancelled'
  if (exitCode === null || exitCode === 0) return 'succeeded'
  return 'failed'
}

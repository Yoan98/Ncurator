export type TerminalToolStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export type TerminalRunOutput = {
  terminalId: string
  status: TerminalToolStatus
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
}

export type TerminalReadOutput = {
  status: TerminalToolStatus
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
}

export type TerminalStopOutput = {
  terminalId: string
  status: 'stopped'
}

export type TerminalSessionEntry = {
  terminalId: string
  status: 'idle' | 'running' | 'stopping'
  command: string
  runningSeconds: number
}

export type TerminalSessionLimitOutput = {
  error: 'terminal_session_limit_reached'
  sessions: TerminalSessionEntry[]
}

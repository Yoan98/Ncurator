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

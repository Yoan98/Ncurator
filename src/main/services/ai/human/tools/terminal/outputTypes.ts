export type TerminalStatus = 'running' | 'completed' | 'cancelled'

export type TerminalSessionOutput = {
  terminalId: string
  status: TerminalStatus
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
  exitCode: number | null
}

export type TerminalRunOutput = TerminalSessionOutput
export type TerminalReadOutput = TerminalSessionOutput

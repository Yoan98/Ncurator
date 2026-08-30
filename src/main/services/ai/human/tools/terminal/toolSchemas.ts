import { z } from 'zod/v4'

export type TerminalStatus = 'running' | 'completed' | 'cancelled'

export type TerminalSessionOutput = {
  terminalId: string
  status: TerminalStatus
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
  exitCode: number | null
}

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1).describe('要在终端执行的命令'),
  commandExplanation: z.string().min(1).describe('命令意图说明，供审批与日志使用')
})

export const TERMINAL_READ_SCHEMA = z.object({
  terminalId: z.string().min(1).describe('terminal_run 返回的终端会话 ID'),
  readEndPosition: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('上次读取结束位置；省略时从会话起始位置读取')
})

export type TerminalRunOutput = TerminalSessionOutput
export type TerminalReadOutput = TerminalSessionOutput

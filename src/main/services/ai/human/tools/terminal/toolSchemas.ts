import { z } from 'zod/v4'

const TERMINAL_STATUS_SCHEMA = z.enum(['running', 'completed', 'cancelled'])

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

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  terminalId: z.string().describe('终端会话 ID，供 terminal_read 使用'),
  status: TERMINAL_STATUS_SCHEMA.describe('会话状态'),
  output: z.string().describe('自上次读取位置起的增量输出'),
  readEndPosition: z.number().int().nonnegative().describe('本次读取结束位置'),
  hasMoreOutput: z.boolean().describe('是否仍有未读输出'),
  exitCode: z.number().int().nullable().describe('命令退出码；运行中为 null')
})

export const TERMINAL_READ_OUTPUT_SCHEMA = z.object({
  terminalId: z.string().describe('终端会话 ID'),
  status: TERMINAL_STATUS_SCHEMA.describe('会话状态'),
  output: z.string().describe('自 readEndPosition 起的增量输出'),
  readEndPosition: z.number().int().nonnegative().describe('本次读取结束位置'),
  hasMoreOutput: z.boolean().describe('是否仍有未读输出'),
  exitCode: z.number().int().nullable().describe('命令退出码；运行中为 null')
})

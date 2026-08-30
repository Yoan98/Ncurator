import { z } from 'zod/v4'

const TERMINAL_STATUS_SCHEMA = z.enum(['running', 'completed', 'cancelled'])

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  commandExplanation: z.string().min(1)
})

export const TERMINAL_READ_SCHEMA = z.object({
  terminalId: z.string().min(1),
  readEndPosition: z.number().int().nonnegative().optional()
})

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  status: TERMINAL_STATUS_SCHEMA,
  output: z.string(),
  readEndPosition: z.number().int().nonnegative(),
  hasMoreOutput: z.boolean(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_READ_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  status: TERMINAL_STATUS_SCHEMA,
  output: z.string(),
  readEndPosition: z.number().int().nonnegative(),
  hasMoreOutput: z.boolean(),
  exitCode: z.number().int().nullable()
})

import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommandPolicy, analyzeTerminalCommand } from './commandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'
import { TERMINAL_MAX_CONCURRENT_SESSIONS, TERMINAL_READ_MAX_CHARS } from './terminalConstants'

const TERMINAL_STATUS_SCHEMA = z.enum(['running', 'completed', 'cancelled'])

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  commandExplanation: z.string().min(1)
})

export const TERMINAL_READ_SCHEMA = z.object({
  terminalId: z.string().min(1),
  outputCursor: z.number().int().nonnegative().optional()
})

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  status: TERMINAL_STATUS_SCHEMA,
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_READ_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  status: TERMINAL_STATUS_SCHEMA,
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

type TerminalRunToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  z.infer<typeof TERMINAL_RUN_OUTPUT_SCHEMA>,
  'terminal_run',
  'terminal'
>

type TerminalReadToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_READ_SCHEMA>,
  z.infer<typeof TERMINAL_READ_OUTPUT_SCHEMA>,
  'terminal_read',
  'terminal'
>

export const createTerminalRunToolSpec = (
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalRunToolSpec => ({
  name: 'terminal_run',
  familyId: 'terminal',
  skillIds: ['terminal'],
  inputSchema: TERMINAL_RUN_SCHEMA,
  outputSchema: TERMINAL_RUN_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_run',
    description:
      '在终端执行命令，返回 terminalId、status、增量输出、输出游标 outputCursor 和退出码。终端默认起始目录是用户的工作区目录。'
  },
  resolveExecutionMeta: (args) => {
    const command = readStringArg(args, 'command') || ''
    const analysis = analyzeTerminalCommand({ command, platform })
    const riskPolicy = analyzeTerminalCommandPolicy(command, platform)
    if (riskPolicy.executionPolicy === 'auto_allow' && analysis.artifactCandidates.length === 0) {
      return { mutability: 'read_only', resourceKey: analysis.resourceKey }
    }
    return { mutability: 'mutating', resourceKey: analysis.resourceKey }
  }
})

export const TERMINAL_READ_TOOL_SPEC: TerminalReadToolSpec = {
  name: 'terminal_read',
  familyId: 'terminal',
  skillIds: ['terminal'],
  inputSchema: TERMINAL_READ_SCHEMA,
  outputSchema: TERMINAL_READ_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_read',
    description:
      '读取正在运行命令的终端：传入 terminalId 读取该终端从输出游标开始的增量输出和状态，返回 terminalId、状态 status、增量输出、最新游标和退出码。' +
      `单次最多返回 ${TERMINAL_READ_MAX_CHARS} 字符。`
  },
  resolveExecutionMeta: () => ({ mutability: 'read_only' })
}

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC, TERMINAL_READ_TOOL_SPEC] as const

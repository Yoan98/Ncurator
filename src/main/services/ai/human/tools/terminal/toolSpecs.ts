import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommandPolicy, analyzeTerminalCommand } from './commandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'

const TERMINAL_STATUS_SCHEMA = z.enum(['idle', 'running', 'stopping', 'closed'])

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  commandExplanation: z.string().min(1)
})

export const TERMINAL_READ_SCHEMA = z.object({
  terminalId: z.string().min(1).optional(),
  outputCursor: z.number().int().nonnegative().optional()
})

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  terminalStatus: TERMINAL_STATUS_SCHEMA,
  executionStatus: z.enum(['running', 'completed', 'cancelled']),
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_READ_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  terminalStatus: TERMINAL_STATUS_SCHEMA,
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_SNAPSHOT_SCHEMA = z.object({
  terminalId: z.string(),
  status: TERMINAL_STATUS_SCHEMA,
  currentPath: z.string(),
  currentCommand: z.string().nullable()
})

export const TERMINAL_READ_LIST_OUTPUT_SCHEMA = z.union([
  TERMINAL_READ_OUTPUT_SCHEMA,
  z.array(TERMINAL_SNAPSHOT_SCHEMA)
])

type TerminalRunToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  z.infer<typeof TERMINAL_RUN_OUTPUT_SCHEMA>,
  'terminal_run',
  'terminal'
>

type TerminalReadToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_READ_SCHEMA>,
  z.infer<typeof TERMINAL_READ_LIST_OUTPUT_SCHEMA>,
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
      '在终端执行命令，并返回 terminalId、终端状态、执行状态、增量输出、输出游标和退出码。终端默认起始目录是用户的工作区目录。'
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
      '读取正在运行命令的终端：不传 terminalId 时返回当前会话所有终端的列表（terminalId、状态、当前路径、当前命令）；传入 terminalId 时读取该终端从输出游标开始的增量输出和状态，并返回 terminalId、终端状态、增量输出、最新游标和退出码。'
  },
  resolveExecutionMeta: () => ({ mutability: 'read_only' })
}

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC, TERMINAL_READ_TOOL_SPEC] as const

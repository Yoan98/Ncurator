import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeSafeTerminalCommandPolicy, analyzeTerminalCommand } from './commandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'

const TERMINAL_STATUS_SCHEMA = z.enum(['idle', 'running', 'stopping', 'closed'])

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  commandExplanation: z.string().min(1),
  terminalId: z.string().min(1).optional()
})

export const TERMINAL_READ_SCHEMA = z.object({
  terminalId: z.string().min(1),
  outputCursor: z.number().int().nonnegative().optional()
})

export const TERMINAL_STOP_SCHEMA = z.object({
  terminalId: z.string().min(1),
  closeTerminal: z.boolean().optional()
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

export const TERMINAL_STOP_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  terminalStatus: TERMINAL_STATUS_SCHEMA,
  stopped: z.boolean(),
  forced: z.boolean()
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

type TerminalStopToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_STOP_SCHEMA>,
  z.infer<typeof TERMINAL_STOP_OUTPUT_SCHEMA>,
  'terminal_stop',
  'terminal'
>

export const createTerminalRunToolSpec = (
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalRunToolSpec => ({
  name: 'terminal_run',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  inputSchema: TERMINAL_RUN_SCHEMA,
  outputSchema: TERMINAL_RUN_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_run',
    description:
      '在持久终端中执行命令，并返回 terminalId、终端状态、执行状态、增量输出、输出游标和退出码。若已有状态为 idle 的终端且不需要新的独立终端环境，优先传入其 terminalId 复用；不传 terminalId 时会创建新终端。'
  },
  resolveExecutionMeta: (args) => {
    const command = readStringArg(args, 'command') || ''
    const analysis = analyzeTerminalCommand({ command, platform })
    const safePolicy = analyzeSafeTerminalCommandPolicy(command, platform)
    if (safePolicy.executionPolicy === 'safe_allowed' && analysis.artifactCandidates.length === 0) {
      return { mutability: 'read_only', resourceKey: analysis.resourceKey }
    }
    return { mutability: 'mutating', resourceKey: analysis.resourceKey }
  }
})

export const TERMINAL_READ_TOOL_SPEC: TerminalReadToolSpec = {
  name: 'terminal_read',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  inputSchema: TERMINAL_READ_SCHEMA,
  outputSchema: TERMINAL_READ_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_read',
    description:
      '读取持久终端从输出游标开始的增量输出和状态，并返回 terminalId、终端状态、增量输出、最新游标和退出码。'
  },
  resolveExecutionMeta: () => ({ mutability: 'read_only' })
}

export const TERMINAL_STOP_TOOL_SPEC: TerminalStopToolSpec = {
  name: 'terminal_stop',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  inputSchema: TERMINAL_STOP_SCHEMA,
  outputSchema: TERMINAL_STOP_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_stop',
    description:
      '停止持久终端中的当前命令并可同时关闭终端，并返回 terminalId、停止结果、是否强制终止和终端状态；正常停止后终端可继续复用，强制终止后终端会关闭。'
  },
  resolveExecutionMeta: () => ({ mutability: 'mutating' })
}

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [
  TERMINAL_RUN_TOOL_SPEC,
  TERMINAL_READ_TOOL_SPEC,
  TERMINAL_STOP_TOOL_SPEC
] as const

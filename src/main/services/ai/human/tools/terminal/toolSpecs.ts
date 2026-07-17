import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import {
  analyzeSafeTerminalCommandPolicy,
  analyzeTerminalCommand,
  getSafeCommandGuidance
} from './commandPolicy'
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
  returnReason: z.enum([
    'command_completed',
    'command_still_running',
    'command_stopped',
    'terminal_closed'
  ]),
  currentTerminalPath: z.string(),
  executionStatus: z.enum(['running', 'completed', 'cancelled']),
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_READ_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  terminalStatus: TERMINAL_STATUS_SCHEMA,
  currentTerminalPath: z.string(),
  output: z.string(),
  outputCursor: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable()
})

export const TERMINAL_STOP_OUTPUT_SCHEMA = z.object({
  terminalId: z.string(),
  terminalStatus: TERMINAL_STATUS_SCHEMA,
  currentTerminalPath: z.string(),
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
    description: `能力：在当前 workspace 和允许的用户级 runtime 边界内新建持久终端或在指定空闲终端中执行命令；命令超过固定等待时间后会返回 running 状态，进程继续运行。\n结果：返回终端状态、当前路径、增量输出、输出游标和退出码。\n边界：${platform === 'windows' ? 'Windows 终端使用 PowerShell。' : 'macOS 终端使用 zsh。'}安全指令集包含 ${getSafeCommandGuidance(platform)}；安全集外命令需要用户审批；运行中的终端不能接受新命令；禁止通过 shell 后台符号绕过终端会话管理。`,
    whenToUse: '适用于需要执行终端命令的任务。',
    examples: []
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
      '能力：读取指定持久终端从输出游标开始的增量输出和当前状态。\n结果：返回终端状态、当前路径、增量输出、最新输出游标和退出码。\n边界：只读取当前会话中的终端，不执行命令。',
    whenToUse: '适用于读取已有终端的状态或输出。',
    examples: []
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
      '能力：停止指定持久终端中的当前命令，并可同时关闭终端。\n结果：返回停止结果、是否强制终止、终端状态和当前路径。\n边界：只操作当前会话中的终端。',
    whenToUse: '适用于停止已有终端中的命令或关闭终端。',
    examples: []
  },
  resolveExecutionMeta: () => ({ mutability: 'mutating' })
}

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [
  TERMINAL_RUN_TOOL_SPEC,
  TERMINAL_READ_TOOL_SPEC,
  TERMINAL_STOP_TOOL_SPEC
] as const

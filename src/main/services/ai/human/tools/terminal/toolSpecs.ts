import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommand } from './terminalCommandPolicy'
import {
  analyzeReadonlyTerminalCommandPolicy,
  TERMINAL_READONLY_COMMAND_GUIDANCE
} from './readonlyCommandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional()
})

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  command: z.string(),
  cwd: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  outputPreview: z.string(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  artifacts: z.array(
    z.object({
      path: z.string(),
      operation: z.string()
    })
  )
})

export const TERMINAL_RUN_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  z.infer<typeof TERMINAL_RUN_OUTPUT_SCHEMA>,
  'terminal_run',
  'terminal'
> = {
  name: 'terminal_run',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  inputSchema: TERMINAL_RUN_SCHEMA,
  outputSchema: TERMINAL_RUN_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'terminal_run',
    description: `能力：执行一条当前 workspace 边界内的终端命令。\n结果：返回 stdout、stderr、exitCode、超时或截断状态，以及可识别的工作区文件产物。\n边界：符合系统只读命令策略的会被直接执行；当前默认允许的只读指令包含 ${TERMINAL_READONLY_COMMAND_GUIDANCE}。其他命令将会被用户审批后再执行。`,
    whenToUse: '适用于需要使用当前 workspace 终端命令能力的任务。',
    examples: [
      {
        goal: '列出工作目录下的文件',
        args: {
          command: 'ls 工作',
          cwd: '.'
        }
      }
    ]
  },
  resolveExecutionMeta: (args) => {
    const command = readStringArg(args, 'command') || ''
    const analysis = analyzeTerminalCommand({
      command,
      cwd: readStringArg(args, 'cwd')
    })
    const readonlyPolicy = analyzeReadonlyTerminalCommandPolicy(command)
    if (
      readonlyPolicy.executionPolicy === 'readonly_allowed' &&
      analysis.artifactCandidates.length === 0
    ) {
      return {
        mutability: 'read_only',
        resourceKey: analysis.resourceKey
      }
    }
    return {
      mutability: 'mutating',
      resourceKey: analysis.resourceKey
    }
  }
}

export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC] as const

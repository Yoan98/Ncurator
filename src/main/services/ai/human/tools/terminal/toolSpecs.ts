import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommand } from './terminalCommandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'

export const WORKSPACE_RUN_COMMAND_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional()
})

export const WORKSPACE_RUN_COMMAND_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WORKSPACE_RUN_COMMAND_SCHEMA>,
  'workspace_run_command',
  'workspace-cli'
> = {
  name: 'workspace_run_command',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: WORKSPACE_RUN_COMMAND_SCHEMA,
  promptSpec: {
    name: 'workspace_run_command',
    description:
      '在 workspace 内执行单条命令，让你自主使用系统命令行完成检查、搜索、读取、验证或生成中间结果。',
    whenToUse:
      '当任务需要直接通过命令行处理 workspace 内容，或需要用单条命令验证环境与结果时使用。',
    preconditions: ['command 必须是单条明确命令。', 'cwd 如果提供，必须位于 workspace 内。'],
    returns: [
      {
        name: 'outputPreview',
        type: 'string',
        description: '命令输出预览。'
      }
    ],
    examples: [
      {
        goal: '在 workspace 根目录执行 pwd',
        args: {
          command: 'pwd',
          cwd: '.'
        }
      }
    ]
  },
  resolveExecutionMeta: (args) => {
    const analysis = analyzeTerminalCommand({
      command: readStringArg(args, 'command') || '',
      cwd: readStringArg(args, 'cwd')
    })
    if (
      analysis.riskLevel === 'low' &&
      analysis.commandMode === 'read_only' &&
      analysis.artifactCandidates.length === 0
    ) {
      return {
        mutability: 'read_only',
        parallelSafe: true,
        resourceKey: analysis.resourceKey
      }
    }
    return {
      mutability: 'mutating',
      parallelSafe: false,
      resourceKey: analysis.resourceKey
    }
  }
}

export const TERMINAL_TOOL_SPECS = [WORKSPACE_RUN_COMMAND_TOOL_SPEC] as const

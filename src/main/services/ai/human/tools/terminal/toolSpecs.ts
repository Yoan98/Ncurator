import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import { analyzeTerminalCommand } from './terminalCommandPolicy'
import type { HumanToolSpec } from '../types'
import { readStringArg } from '../utils/toolSpecUtils'

const TERMINAL_COMMAND_EXAMPLE: JsonObject = {
  command: 'cat ai/workspace/materials/daily/2026-03-16-note.md',
  cwd: '.'
}

const TERMINAL_ARTIFACT_COMMAND_EXAMPLE: JsonObject = {
  command: 'node scripts/export-risk-report.mjs',
  cwd: '.',
  expectedArtifacts: [
    {
      path: 'artifacts/risk-report.md',
      operation: 'created',
      summary: '导出的风险报告草稿'
    }
  ]
}

const artifactHintSchema = z.object({
  path: z.string(),
  operation: z.enum(['created', 'updated']).optional(),
  summary: z.string().optional()
})

export const TERMINAL_RUN_COMMAND_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  expectedArtifacts: z.array(artifactHintSchema).optional()
})

export const TERMINAL_RUN_COMMAND_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_COMMAND_SCHEMA>,
  'terminal_run_command',
  'workspace-cli'
> = {
  name: 'terminal_run_command',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: TERMINAL_RUN_COMMAND_SCHEMA,
  promptSpec: {
    name: 'terminal_run_command',
    purpose: '在 workspace 内执行单条 shell 命令，读取文件、检查环境或生成中间产物。',
    whenToUse:
      '只有当 KB 或 docx 工具不能直接完成任务，且确实需要 shell 读取、验证、转换或产出文件时使用。',
    preconditions: [
      '必须存在 workspace 绑定。',
      'command 必须是单条明确命令，不能用空命令探测环境。',
      '若会生成文件，优先在 expectedArtifacts 中声明目标产物。'
    ],
    args: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: '要执行的单条 shell 命令。'
      },
      {
        name: 'cwd',
        type: 'string',
        required: false,
        description: 'workspace 内相对或绝对目录；省略时默认 workspace 根目录。'
      },
      {
        name: 'expectedArtifacts',
        type: 'Array<{ path: string; operation?: "created" | "updated"; summary?: string }>',
        required: false,
        description: '预期会产生或更新的文件，便于产物识别与 artifact 事件记录。'
      }
    ],
    returns: [
      {
        name: 'ok',
        type: 'boolean',
        description: '命令是否成功执行。'
      },
      {
        name: 'outputPreview',
        type: 'string',
        description: 'stdout/stderr 的截断预览。'
      },
      {
        name: 'artifacts',
        type: 'Array<{ path: string; operation: "created" | "updated" }>',
        description: '检测到并记录的文件产物。'
      }
    ],
    examples: [
      {
        goal: '读取单个 workspace 材料文件',
        args: TERMINAL_COMMAND_EXAMPLE
      },
      {
        goal: '声明会产生产物的单条命令',
        args: TERMINAL_ARTIFACT_COMMAND_EXAMPLE
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

export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_COMMAND_TOOL_SPEC] as const

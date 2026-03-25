import type { JsonObject } from '../../../../../../../shared/types'
import { z } from 'zod/v4'
import type { CapabilityToolDefinition } from '../factories'
import { createCapabilityToolDefinition, readStringArg } from '../factories'
import { analyzeTerminalCommand } from '../../terminal/terminalCommandPolicy'

const TERMINAL_COMMAND_EXAMPLE: JsonObject = {
  command: 'cat ai/workspace/materials/daily/2026-03-16-note.md',
  cwd: '.'
}

const artifactHintSchema = z.object({
  path: z.string(),
  operation: z.enum(['created', 'updated']).optional(),
  summary: z.string().optional()
})

export const terminalRunCommandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  expectedArtifacts: z.array(artifactHintSchema).optional()
})

const resolveTerminalExecutionMeta: CapabilityToolDefinition['resolveExecutionMeta'] = (args) => {
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

export const TERMINAL_RUN_COMMAND_CONTRACT = createCapabilityToolDefinition({
  name: 'terminal_run_command',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: terminalRunCommandSchema,
  promptSpec: {
    name: 'terminal_run_command',
    purpose: '在 workspace 内执行单条 shell 命令，读取文件、检查环境或生成中间产物。',
    whenToUse:
      '只有当 KB 或 DOCX 工具不能直接完成任务，且确实需要 shell 读取/验证/产出文件时才使用。',
    preconditions: [
      '必须存在 workspace 绑定。',
      'command 必须是单条明确命令，不能靠空命令探测环境。',
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
        description: '预期会产生或更新的文件，便于产物识别与 artifact 事件落地。'
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
        description: 'stdout/stderr 的截断预览，用于后续推理。'
      },
      {
        name: 'artifacts',
        type: 'Array<{ path: string; operation: "created" | "updated" }>',
        description: '检测到并成功记录的文件产物。'
      }
    ],
    commonMistakes: [
      '不要把 shell 当成 KB 检索或 DOCX 编辑的默认入口。',
      '不要把多步流程塞进一条又长又难解释的命令。',
      '命中 approval_denied 或 workspace_required 后不要重复同一命令。'
    ],
    examples: [
      {
        goal: '读取单个 workspace 材料文件',
        args: TERMINAL_COMMAND_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: resolveTerminalExecutionMeta
})

export const TERMINAL_TOOL_DEFINITIONS = [
  TERMINAL_RUN_COMMAND_CONTRACT
] as const

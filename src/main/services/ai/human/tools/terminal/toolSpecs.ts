import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommand } from './terminalCommandPolicy'
import { readStringArg } from '../utils/toolSpecUtils'

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional()
})

export const TERMINAL_RUN_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  'terminal_run',
  'terminal'
> = {
  name: 'terminal_run',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  schema: TERMINAL_RUN_SCHEMA,
  promptSpec: {
    name: 'terminal_run',
    description:
      '执行一条工作区终端命令，并返回 stdout、stderr、exitCode、是否超时或截断，以及可识别的工作区文件 artifact。',
    whenToUse:
      '当你需要通过终端命令获取信息、检索内容、读取文件、检查环境、运行程序，或在工作区内生成或修改产物时使用。',
    examples: [
      {
        goal: '运行一条只读 Python 命令列出工作目录内容',
        args: {
          command: 'python3 -c "from pathlib import Path; print([p.name for p in Path(\'工作\').iterdir()])"',
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
    const hasInterpreterInlineProgram =
      /^\s*(python|python3)\b.*\s-c\b/.test(command) || /^\s*node\b.*\s-e\b/.test(command)
    if (
      analysis.riskLevel === 'low' &&
      analysis.commandMode === 'read_only' &&
      analysis.artifactCandidates.length === 0 &&
      !hasInterpreterInlineProgram
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

export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC] as const

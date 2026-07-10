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

export const TERMINAL_RUN_SCHEMA = z.object({
  command: z.string().min(1),
  commandExplanation: z.string().min(1),
  cwd: z.string().optional()
})

export const TERMINAL_RUN_OUTPUT_SCHEMA = z.object({
  command: z.string(),
  cwd: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  artifacts: z.array(
    z.object({
      path: z.string(),
      operation: z.string()
    })
  )
})

type TerminalRunToolSpec = HumanToolSpec<
  z.infer<typeof TERMINAL_RUN_SCHEMA>,
  z.infer<typeof TERMINAL_RUN_OUTPUT_SCHEMA>,
  'terminal_run',
  'terminal'
>

export const createTerminalRunPromptSpec = (
  platform: AiRuntimePlatform
): TerminalRunToolSpec['promptSpec'] => {
  const shellDescription =
    platform === 'windows'
      ? '当前 Windows terminal 使用 PowerShell 执行命令，必须使用 PowerShell 语法。'
      : '当前 macOS terminal 使用 zsh 执行命令，必须使用 zsh 语法。'
  const exampleCommand = platform === 'windows' ? 'Get-ChildItem -LiteralPath .' : 'ls .'

  return {
    name: 'terminal_run',
    description: `能力：执行一条当前 workspace 边界内的终端命令。\n结果：返回 stdout、stderr、exitCode、超时状态，以及可识别的工作区文件产物。\n边界：${shellDescription}当前平台安全指令集包含 ${getSafeCommandGuidance(platform)}；安全集外命令会先进入用户审批。默认禁止搜索隐藏文件如.*，除非用户明确允许。禁止用 terminal 读取或写入 Word / Excel / PPT / PDF 等结构化文档内容。`,
    whenToUse: '适用于需要使用当前 workspace 终端命令能力的任务。',
    examples: [
      {
        goal: '列出工作目录下的文件',
        args: {
          command: exampleCommand,
          commandExplanation: '列出当前工作目录下的文件和文件夹。',
          cwd: '.'
        }
      }
    ]
  }
}

export const createTerminalRunToolSpec = (
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalRunToolSpec => ({
  name: 'terminal_run',
  familyId: 'terminal',
  skillIds: ['terminal'],
  requiresWorkspace: true,
  inputSchema: TERMINAL_RUN_SCHEMA,
  outputSchema: TERMINAL_RUN_OUTPUT_SCHEMA,
  promptSpec: createTerminalRunPromptSpec(platform),
  resolveExecutionMeta: (args) => {
    const command = readStringArg(args, 'command') || ''
    const analysis = analyzeTerminalCommand({
      command,
      cwd: readStringArg(args, 'cwd'),
      platform
    })
    const safePolicy = analyzeSafeTerminalCommandPolicy(command, platform)
    if (safePolicy.executionPolicy === 'safe_allowed' && analysis.artifactCandidates.length === 0) {
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
})

export const TERMINAL_RUN_TOOL_SPEC = createTerminalRunToolSpec()
export const TERMINAL_TOOL_SPECS = [TERMINAL_RUN_TOOL_SPEC] as const

import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { analyzeTerminalCommand } from './terminalCommandPolicy'
import {
  createStaticExecutionMetaResolver,
  readStringArg
} from '../utils/toolSpecUtils'

export const WORKSPACE_LIST_FILES_SCHEMA = z.object({
  path: z.string().optional(),
  filePattern: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const WORKSPACE_SEARCH_TEXT_SCHEMA = z.object({
  query: z.string().min(1),
  path: z.string().optional(),
  filePattern: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const WORKSPACE_READ_FILE_SCHEMA = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional()
})

export const WORKSPACE_RUN_COMMAND_SCHEMA = z.object({
  command: z.string().min(1),
  cwd: z.string().optional()
})

const READ_ONLY_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  parallelSafe: true,
  getResourceKey: (args) => readStringArg(args, 'path') || 'workspace'
})

export const WORKSPACE_LIST_FILES_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WORKSPACE_LIST_FILES_SCHEMA>,
  'workspace_list_files',
  'workspace-cli'
> = {
  name: 'workspace_list_files',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: WORKSPACE_LIST_FILES_SCHEMA,
  promptSpec: {
    name: 'workspace_list_files',
    purpose: '列出 workspace 内的文件，适合先看目录与候选文件。',
    whenToUse: '当你需要像 ls / find 一样先看有哪些文件，而不是直接执行 shell 时使用。',
    preconditions: ['path 如果提供，必须位于 workspace 内。'],
    returns: [
      {
        name: 'items',
        type: 'Array<{ path: string; type: string }>',
        description: '匹配到的文件或目录。'
      }
    ],
    examples: [
      {
        goal: '列出 src 下的 ts 文件',
        args: {
          path: 'src',
          filePattern: '**/*.ts',
          limit: 30
        }
      }
    ]
  },
  resolveExecutionMeta: READ_ONLY_META
}

export const WORKSPACE_SEARCH_TEXT_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WORKSPACE_SEARCH_TEXT_SCHEMA>,
  'workspace_search_text',
  'workspace-cli'
> = {
  name: 'workspace_search_text',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: WORKSPACE_SEARCH_TEXT_SCHEMA,
  promptSpec: {
    name: 'workspace_search_text',
    purpose: '在 workspace 内按关键词搜索文本。',
    whenToUse: '当你想像 rg 一样查某个词出现在哪些文件和行时使用。',
    preconditions: ['query 不能为空。'],
    returns: [
      {
        name: 'matches',
        type: 'Array<{ path: string; line: number; text: string }>',
        description: '命中的文件、行号与文本片段。'
      }
    ],
    examples: [
      {
        goal: '搜索工具注册相关代码',
        args: {
          query: 'history_search',
          path: 'src',
          limit: 20
        }
      }
    ]
  },
  resolveExecutionMeta: READ_ONLY_META
}

export const WORKSPACE_READ_FILE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WORKSPACE_READ_FILE_SCHEMA>,
  'workspace_read_file',
  'workspace-cli'
> = {
  name: 'workspace_read_file',
  familyId: 'terminal',
  skillIds: ['workspace-cli'],
  requiresWorkspace: true,
  schema: WORKSPACE_READ_FILE_SCHEMA,
  promptSpec: {
    name: 'workspace_read_file',
    purpose: '读取 workspace 内文件内容，可按行范围截取。',
    whenToUse: '当你已经知道要读哪个文件，只需读取内容或局部片段时使用。',
    preconditions: ['path 必须是 workspace 内的文件。'],
    returns: [
      {
        name: 'content',
        type: 'string',
        description: '读取到的文件内容片段。'
      }
    ],
    examples: [
      {
        goal: '读取某个文件的前 120 行',
        args: {
          path: 'src/main/services/ai/human/skills.ts',
          startLine: 1,
          endLine: 120
        }
      }
    ]
  },
  resolveExecutionMeta: READ_ONLY_META
}

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
    purpose: '在 workspace 内执行单条 shell 命令。',
    whenToUse: '当 list/search/read 无法完成任务，且确实需要 CLI 验证、转换或生成中间结果时使用。',
    preconditions: ['command 必须是单条明确命令。'],
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

export const TERMINAL_TOOL_SPECS = [
  WORKSPACE_LIST_FILES_TOOL_SPEC,
  WORKSPACE_SEARCH_TEXT_TOOL_SPEC,
  WORKSPACE_READ_FILE_TOOL_SPEC,
  WORKSPACE_RUN_COMMAND_TOOL_SPEC
] as const

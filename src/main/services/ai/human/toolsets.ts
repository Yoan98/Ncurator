import { HUMAN_TOOLSET_SOURCES, RUNTIME_TOOLSET_IDS } from './constants'
import {
  RUNTIME_TOOL_CATALOG,
  RUNTIME_TOOL_NAMES,
  type RuntimeToolFamilyId,
  type RuntimeToolName
} from '../../../../shared/runtimeCapabilities'
import type { RuntimeToolsetId, ToolsetDefinition } from './types'

type RuntimeToolsetSource = (typeof HUMAN_TOOLSET_SOURCES)[number]

type RuntimeToolsetCatalogEntry = {
  familyId: RuntimeToolFamilyId
  source: RuntimeToolsetSource
  countsTowardToolBudget: boolean
  title: string
  description: string
}

export const RUNTIME_TOOLSET_CATALOG = {
  terminal: {
    familyId: 'terminal',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'terminal',
    description:
      '在用户工作区根目录执行和读取命令，并返回终端状态、增量输出、退出状态和用户工作区域文件产物。'
  },
  'text-file': {
    familyId: 'text-file',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'text-file',
    description: '读取和写入 Markdown、TXT、代码等 UTF-8 普通文本文件。'
  },
  'kb-retrieval': {
    familyId: 'kb',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'kb-retrieval',
    description:
      '查询用户工作区域知识库的已索引文档或检索相关内容片段，并返回命中证据、来源文档与内容块信息。'
  },
  'web-browsing': {
    familyId: 'web',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'web-browsing',
    description: '搜索公开网页、抓取网页正文，或操作内置浏览器。'
  },
  'docx-read': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description: '读取 .docx、.doc 文件的内容。'
  },
  'docx-write': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description: '创建或编辑 DOCX 文件。'
  },
  'pdf-read': {
    familyId: 'pdf',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'pdf-read',
    description: '读取 PDF 文件内容。'
  },
  'ppt-read': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-read',
    description: '读取 PPTX 文件内容。'
  },
  'ppt-write': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-write',
    description: '创建或编辑 PPTX 文件。'
  },
  'excel-read': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-read',
    description: '读取 Excel 文件内容。'
  },
  'excel-write': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-write',
    description: '创建或编辑 Excel 文件。'
  },
  'image-generation': {
    familyId: 'image-generation',
    source: 'external',
    countsTowardToolBudget: true,
    title: '图片生成',
    description: '通过 SVG 绘制生成 PNG、JPEG 或 WebP 图片，并保存为用户工作区域文件。'
  },
  'agent-control': {
    familyId: 'agent-control',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'agent-control',
    description: '管理任务推进：加载工具组和用户技能说明、维护计划，并加载图片到主模型上下文。'
  },
  'skill-management': {
    familyId: 'skill-management',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'skill 管理',
    description: '查询 Skill 启用状态、同步目录索引并配置当前伙伴。'
  },
  'scheduled-tasks': {
    familyId: 'scheduled-tasks',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'scheduled-tasks',
    description: '读取、创建、修改和删除当前伙伴的定时任务。'
  }
} as const satisfies Record<RuntimeToolsetId, RuntimeToolsetCatalogEntry>

export const BUILTIN_RUNTIME_TOOLSET_IDS = RUNTIME_TOOLSET_IDS.filter(
  (toolsetId) => RUNTIME_TOOLSET_CATALOG[toolsetId].source === 'builtin'
)

export const EXTERNAL_RUNTIME_TOOLSET_IDS = RUNTIME_TOOLSET_IDS.filter(
  (toolsetId) => RUNTIME_TOOLSET_CATALOG[toolsetId].source === 'external'
)

export function listRuntimeToolNamesForToolset(toolsetId: RuntimeToolsetId): RuntimeToolName[] {
  return RUNTIME_TOOL_NAMES.filter(
    (toolName) => toolsetId === RUNTIME_TOOL_CATALOG[toolName].toolsetId
  )
}

export const TOOLSET_DEFINITIONS = Object.fromEntries(
  RUNTIME_TOOLSET_IDS.map((toolsetId) => {
    const definition = RUNTIME_TOOLSET_CATALOG[toolsetId]
    return [
      toolsetId,
      {
        toolsetId,
        familyId: definition.familyId,
        source: definition.source,
        countsTowardToolBudget: definition.countsTowardToolBudget,
        title: definition.title,
        description: definition.description,
        toolNames: listRuntimeToolNamesForToolset(toolsetId)
      }
    ]
  })
) as Record<RuntimeToolsetId, ToolsetDefinition>

export const hasToolsetDefinition = (toolsetId: string): toolsetId is RuntimeToolsetId =>
  RUNTIME_TOOLSET_IDS.includes(toolsetId as RuntimeToolsetId)

export const isBuiltinToolsetId = (toolsetId: string): toolsetId is RuntimeToolsetId =>
  BUILTIN_RUNTIME_TOOLSET_IDS.includes(toolsetId as (typeof BUILTIN_RUNTIME_TOOLSET_IDS)[number])

export const isLoadableToolsetId = (toolsetId: string): toolsetId is RuntimeToolsetId =>
  EXTERNAL_RUNTIME_TOOLSET_IDS.includes(toolsetId as (typeof EXTERNAL_RUNTIME_TOOLSET_IDS)[number])

export const assertExternalLoadedToolsetIds = (loadedToolsetIds: RuntimeToolsetId[]): void => {
  const invalidBuiltinToolsetIds = loadedToolsetIds.filter((toolsetId) =>
    isBuiltinToolsetId(toolsetId)
  )
  if (invalidBuiltinToolsetIds.length === 0) return

  throw new Error(
    `loadedToolsetIds 只允许 external toolset，检测到 builtin toolset=[${invalidBuiltinToolsetIds.join(', ')}]。`
  )
}

export const getToolsetDefinition = (toolsetId: RuntimeToolsetId): ToolsetDefinition => {
  const definition = TOOLSET_DEFINITIONS[toolsetId]
  if (!definition) {
    throw new Error(`missing runtime toolset definition for ${toolsetId}`)
  }
  return {
    ...definition,
    toolNames: [...definition.toolNames]
  }
}

export const listBuiltinToolsetDefinitions = (): ToolsetDefinition[] =>
  BUILTIN_RUNTIME_TOOLSET_IDS.map((toolsetId) => getToolsetDefinition(toolsetId))

export const listExternalToolsetDefinitions = (): ToolsetDefinition[] =>
  EXTERNAL_RUNTIME_TOOLSET_IDS.map((toolsetId) => getToolsetDefinition(toolsetId))

export const getEffectiveLoadedToolsetIds = (
  loadedToolsetIds: RuntimeToolsetId[]
): RuntimeToolsetId[] => {
  const seen = new Set<RuntimeToolsetId>()
  const ordered = [...BUILTIN_RUNTIME_TOOLSET_IDS, ...loadedToolsetIds]

  return ordered.filter((toolsetId) => {
    if (seen.has(toolsetId)) return false
    seen.add(toolsetId)
    return true
  })
}

export const findEffectiveToolsetIdByToolName = (input: {
  toolName: string
  loadedToolsetIds: RuntimeToolsetId[]
}): RuntimeToolsetId | undefined => {
  const target = String(input.toolName || '').trim()
  return getEffectiveLoadedToolsetIds(input.loadedToolsetIds).find((toolsetId) =>
    getToolsetDefinition(toolsetId).toolNames.includes(target)
  )
}

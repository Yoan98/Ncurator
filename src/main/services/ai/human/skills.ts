import { HUMAN_SKILL_SOURCES, RUNTIME_SKILL_IDS } from './constants'
import {
  RUNTIME_TOOL_CATALOG,
  RUNTIME_TOOL_NAMES,
  type RuntimeToolFamilyId,
  type RuntimeToolName
} from '../../../../shared/runtimeCapabilities'
import type { RuntimeSkillId, SkillDefinition } from './types'

type RuntimeSkillSource = (typeof HUMAN_SKILL_SOURCES)[number]

type RuntimeSkillCatalogEntry = {
  familyId: RuntimeToolFamilyId
  source: RuntimeSkillSource
  countsTowardToolBudget: boolean
  title: string
  description: string
}

export const RUNTIME_SKILL_CATALOG = {
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
    description:
      '按关键词搜索并读取公开网页正文，或直接读取指定网页，或操作内置浏览器，并返回网页正文、链接或浏览器动作结果。'
  },
  'docx-read': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description: '读取 .docx、.doc 的结构、节点、检索结果和视觉内容。'
  },
  'docx-write': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description: '创建或编辑 DOCX 的正文、样式、表格、媒体、批注和修订。'
  },
  'pdf-read': {
    familyId: 'pdf',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'pdf-read',
    description: '读取 PDF 文档信息、页级文本、检索结果和页面视觉内容。'
  },
  'ppt-read': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-read',
    description: '读取 PPTX 的页面提纲、内容、检索结果和页面视觉内容。'
  },
  'ppt-write': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-write',
    description: '创建或编辑 PPTX 的页面、元素、文字和备注。'
  },
  'excel-read': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-read',
    description: '读取 Excel 工作簿地图、单元格范围的值与公式、样式，以及按格子搜索。'
  },
  'excel-write': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-write',
    description: '创建或编辑 Excel 工作簿中的工作表、单元格、公式、格式和结构。'
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
    description: '管理任务推进过程：学习技能、维护计划，并把本地或远程图片交给当前主模型读取。'
  }
} as const satisfies Record<RuntimeSkillId, RuntimeSkillCatalogEntry>

export const BUILTIN_RUNTIME_SKILL_IDS = RUNTIME_SKILL_IDS.filter(
  (skillId) => RUNTIME_SKILL_CATALOG[skillId].source === 'builtin'
)

export const EXTERNAL_RUNTIME_SKILL_IDS = RUNTIME_SKILL_IDS.filter(
  (skillId) => RUNTIME_SKILL_CATALOG[skillId].source === 'external'
)

export const LEARNABLE_RUNTIME_SKILL_IDS = EXTERNAL_RUNTIME_SKILL_IDS

export function listRuntimeToolNamesForSkill(skillId: RuntimeSkillId): RuntimeToolName[] {
  return RUNTIME_TOOL_NAMES.filter((toolName) => skillId === RUNTIME_TOOL_CATALOG[toolName].skillId)
}

export const SKILL_DEFINITIONS = Object.fromEntries(
  RUNTIME_SKILL_IDS.map((skillId) => {
    const definition = RUNTIME_SKILL_CATALOG[skillId]
    return [
      skillId,
      {
        skillId,
        familyId: definition.familyId,
        source: definition.source,
        countsTowardToolBudget: definition.countsTowardToolBudget,
        title: definition.title,
        description: definition.description,
        toolNames: listRuntimeToolNamesForSkill(skillId)
      }
    ]
  })
) as Record<RuntimeSkillId, SkillDefinition>

export const hasSkillDefinition = (skillId: string): skillId is RuntimeSkillId =>
  RUNTIME_SKILL_IDS.includes(skillId as RuntimeSkillId)

export const isBuiltinSkillId = (skillId: string): skillId is RuntimeSkillId =>
  BUILTIN_RUNTIME_SKILL_IDS.includes(skillId as (typeof BUILTIN_RUNTIME_SKILL_IDS)[number])

export const isLearnableSkillId = (skillId: string): skillId is RuntimeSkillId =>
  LEARNABLE_RUNTIME_SKILL_IDS.includes(skillId as (typeof LEARNABLE_RUNTIME_SKILL_IDS)[number])

export const assertExternalLearnedSkillIds = (learnedSkillIds: RuntimeSkillId[]): void => {
  const invalidBuiltinSkillIds = learnedSkillIds.filter((skillId) => isBuiltinSkillId(skillId))
  if (invalidBuiltinSkillIds.length === 0) return

  throw new Error(
    `learnedSkillIds 只允许 external skill，检测到 builtin skill=[${invalidBuiltinSkillIds.join(', ')}]。`
  )
}

export const getSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => {
  const definition = SKILL_DEFINITIONS[skillId]
  if (!definition) {
    throw new Error(`missing runtime skill definition for ${skillId}`)
  }
  return {
    ...definition,
    toolNames: [...definition.toolNames]
  }
}

export const listSkillDefinitions = (): SkillDefinition[] =>
  RUNTIME_SKILL_IDS.map((skillId) => getSkillDefinition(skillId))

export const listBuiltinSkillDefinitions = (): SkillDefinition[] =>
  BUILTIN_RUNTIME_SKILL_IDS.map((skillId) => getSkillDefinition(skillId))

export const listExternalSkillDefinitions = (): SkillDefinition[] =>
  EXTERNAL_RUNTIME_SKILL_IDS.map((skillId) => getSkillDefinition(skillId))

export const getEffectiveLearnedSkillIds = (
  learnedSkillIds: RuntimeSkillId[]
): RuntimeSkillId[] => {
  const seen = new Set<RuntimeSkillId>()
  const ordered = [...BUILTIN_RUNTIME_SKILL_IDS, ...learnedSkillIds]

  return ordered.filter((skillId) => {
    if (seen.has(skillId)) return false
    seen.add(skillId)
    return true
  })
}

export const findEffectiveSkillIdByToolName = (input: {
  toolName: string
  learnedSkillIds: RuntimeSkillId[]
}): RuntimeSkillId | undefined => {
  const target = String(input.toolName || '').trim()
  return getEffectiveLearnedSkillIds(input.learnedSkillIds).find((skillId) =>
    getSkillDefinition(skillId).toolNames.includes(target)
  )
}

import {
  BUILTIN_RUNTIME_SKILL_IDS,
  EXTERNAL_RUNTIME_SKILL_IDS,
  LEARNABLE_RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_IDS
} from './constants'
import type { RuntimeSkillId, SkillDefinition } from './types'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, SkillDefinition> = {
  terminal: {
    skillId: 'terminal',
    familyId: 'terminal',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'terminal',
    description:
      '使用持久终端会话执行、读取和停止命令，并返回终端状态、当前路径、增量输出、退出状态和工作区文件产物。',
    toolNames: ['terminal_run', 'terminal_read', 'terminal_stop']
  },
  'text-file': {
    skillId: 'text-file',
    familyId: 'text-file',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'text-file',
    description:
      '读取和写入 Markdown、TXT、代码等 UTF-8 普通文本文件，并返回文本、行范围、执行结果和文件修改记录。 碰到有文本文件操作的需要时，必须要使用该技能',
    toolNames: ['text_file_read', 'text_file_edit']
  },
  'docx-read': {
    skillId: 'docx-read',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description:
      '读取 .docx、.doc 文档的结构、内容块、检索结果和任务内修订历史，并返回块级索引、正文、匹配信息或 revision 信息。 碰到有word阅读的需要时，必须要使用该技能',
    toolNames: ['docx_read_outline', 'docx_search', 'docx_read_blocks']
  },
  'docx-write': {
    skillId: 'docx-write',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description:
      '创建或修改 Word 文档中的段落、标题、表格、文本和样式，并返回写入状态和相邻区域的详细回读信息。 碰到有word编辑的需要时，必须要使用该技能',
    toolNames: ['docx_edit']
  },
  'pdf-read': {
    skillId: 'pdf-read',
    familyId: 'pdf',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'pdf-read',
    description:
      '读取 PDF 文档信息、页级文本、检索结果和页面视觉内容，并返回元数据、正文、匹配位置或视觉识别结果。 碰到有pdf阅读的需要时，必须要使用该技能',
    toolNames: ['pdf_inspect', 'pdf_search', 'pdf_read_pages', 'pdf_read_visuals']
  },
  'ppt-read': {
    skillId: 'ppt-read',
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-read',
    description:
      '读取 PPTX 的页面结构、内容、搜索结果和页面视觉内容，并返回页面提纲、元素、匹配位置或视觉识别结果。碰到有ppt阅读的需要时，必须要使用该技能',
    toolNames: ['ppt_read_outline', 'ppt_read_slides', 'ppt_search', 'ppt_read_visuals']
  },
  'ppt-write': {
    skillId: 'ppt-write',
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-write',
    description:
      '使用受限 HTML 创建或编辑 PPTX 页面和元素，并返回变化页面回读和布局警告。碰到有ppt编辑的需要时，必须要使用该技能',
    toolNames: ['ppt_edit']
  },
  'image-recognition': {
    skillId: 'image-recognition',
    familyId: 'image-recognition',
    source: 'external',
    countsTowardToolBudget: true,
    title: '图像识别',
    description: '读取图片并按 instruction 分析图片内容，并返回模型生成的文本结果。',
    toolNames: ['image_analyze']
  },
  'kb-retrieval': {
    skillId: 'kb-retrieval',
    familyId: 'kb',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'kb-retrieval',
    description:
      '查询工作区知识库的已索引文档或检索相关内容片段，并返回命中证据、来源文档与内容块信息。',
    toolNames: ['kb_list_documents', 'kb_search']
  },
  'web-browsing': {
    skillId: 'web-browsing',
    familyId: 'web',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'web-browsing',
    description:
      '搜索公开网页、抓取网页正文或操作内置浏览器，并返回候选网页、正文与页面链接或浏览器动作结果。',
    toolNames: ['web_search', 'web_crawl', 'browser_use']
  },
  utility: {
    skillId: 'utility',
    familyId: 'utility',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'utility',
    description: '执行任务中的通用辅助动作，并返回对应的客观执行结果。',
    toolNames: ['wait_time', 'wait_for_user_takeover']
  }
}

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

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
      '能力：在当前 workspace 边界内执行单条终端命令。\n结果：返回命令输出、退出状态和可识别的工作区文件产物。\n边界：命令是否可直接执行与是否需要审批由终端命令策略决定。',
    whenToUse: '适用于需要使用当前 workspace 终端能力的任务。',
    toolNames: ['terminal_run']
  },
  'docx-read': {
    skillId: 'docx-read',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description:
      '能力：读取 sourcePath 对应 docx 的结构、内容块、检索结果和任务内修订历史。\n结果：返回块级索引、正文内容、匹配信息或 revision 信息。\n边界：只读取 docx 内容与当前任务内编辑状态，不直接覆盖源文件。',
    whenToUse: '适用于需要读取或理解 docx 内容与修订状态的任务。',
    toolNames: ['docx_outline', 'docx_search', 'docx_read_blocks', 'docx_history']
  },
  'docx-write': {
    skillId: 'docx-write',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description:
      '能力：创建新的 Word 文档，或修改已有 Word 文档中的段落、标题、表格、文本和样式。\n结果：写入后返回相邻区域的详细回读信息，方便检查写入效果或继续下一步编辑。\n边界：只能使用读取工具或写后回读返回的真实 blockId，不要推算 blockId；复杂定位排版区域可能只能给人工修改建议。',
    whenToUse: '适用于用户要求生成、补充、改写、删除或格式化 docx 内容的任务。',
    toolNames: ['docx_edit', 'docx_rollback']
  },
  'image-recognition': {
    skillId: 'image-recognition',
    familyId: 'image-recognition',
    source: 'external',
    countsTowardToolBudget: true,
    title: '图像识别',
    description:
      '能力：读取工作区内图片文件，并基于大模型按给定 instruction 理解图片内容。\n结果：返回模型生成的普通文本结果。\n边界：只负责图像理解，不做 OCR 专项抽取，也不保证模型一定能识别清楚。',
    whenToUse: '适用于需要让模型直接查看图片并回答图片内容的任务。',
    toolNames: ['llm_recognize']
  },
  'kb-retrieval': {
    skillId: 'kb-retrieval',
    familyId: 'kb',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'kb-retrieval',
    description:
      '能力：查询当前工作区知识库中已建立索引的文档列表，或按查询词、语义语句检索相关内容片段。\n结果：返回命中证据、来源文档与内容块信息。\n边界：检索基本单位是内容块，不是整份文档。',
    whenToUse: '适用于需要使用工作区知识库检索能力的任务。',
    toolNames: ['kb_list_documents', 'kb_search']
  },
  'web-browsing': {
    skillId: 'web-browsing',
    familyId: 'web',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'web-browsing',
    description:
      '能力：根据关键词搜索公开网页、抓取明确网页 URL 并返回正文 markdown，或操作内置浏览器执行网页阅读、观察和页面动作。\n结果：搜索返回候选网页列表；抓取返回明确网页正文、标题、发布时间与页面链接；浏览器操作返回可见动作或动作执行结果。\n边界：网页抓取只支持明确公开 http/https URL；搜索结果不是正文证据；内置浏览器操作会显示在该应用的右侧浏览器面板，首次使用需要用户审核。',
    whenToUse: '适用于需要访问网页、读取网页内容或操作网页界面的任务。',
    toolNames: ['web_search', 'web_crawl', 'browser_use']
  },
  utility: {
    skillId: 'utility',
    familyId: 'utility',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'utility',
    description:
      '能力：提供任务执行中的通用辅助动作。\n结果：返回辅助动作的客观执行结果。\n边界：不读取或修改用户内容。',
    whenToUse: '适用于需要通用辅助能力的任务。',
    toolNames: ['wait_time']
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

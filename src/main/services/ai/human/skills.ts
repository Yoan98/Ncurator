import {
  BUILTIN_RUNTIME_SKILL_IDS,
  EXTERNAL_RUNTIME_SKILL_IDS,
  HUMAN_DOCX_BATCH_WRITE_LIMIT,
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
    description: '在当前 workspace 边界内运行单条终端命令。',
    whenToUse: '当你判断终端命令是推进当前任务的合适方式时使用。',
    toolNames: ['terminal_run']
  },
  'docx-read': {
    skillId: 'docx-read',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description: '读取 docx 结构、搜索定位、连续精读区间、查看版本历史。',
    whenToUse: '当任务需要浏览结构、换词搜索、定位 blockId 或连续精读 docx 内容时使用。',
    toolNames: ['docx_outline', 'docx_search', 'docx_read_blocks', 'docx_history']
  },
  'docx-write': {
    skillId: 'docx-write',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description: `创建或编辑 docx，包括段落、标题、表格、文本、样式调整与版本回退。单轮连续 docx 写操作最多只能规划 ${HUMAN_DOCX_BATCH_WRITE_LIMIT} 个；写工具会在返回结果中附带写后复核区域，可据此判断是否需要继续编辑或额外读取`,
    whenToUse: `当你需要新建一份 Word 文件、明确知道要改哪里改成什么，或需要撤销当前草稿修改时使用。`,
    toolNames: [
      'docx_create',
      'docx_paragraph_edit',
      'docx_heading_edit',
      'docx_table_edit',
      'docx_text_edit',
      'docx_text_style_edit',
      'docx_rollback'
    ]
  },
  'kb-retrieval': {
    skillId: 'kb-retrieval',
    familyId: 'kb',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'kb-retrieval',
    description: `工作区知识库检索技能；背后是通过对文档进行分块建立的 fts 和向量索引来实现的，因此检索的基本单位是内容块，而不是整个文档；
    1.可查询当前工作区知识库中已建立索引的文档列表
    2.可按查询词或语句检索本地知识库中相关内容片段，并返回命中证据及其来源文档。`,
    whenToUse:
      '当需要查看工作区知识库中有哪些文档能够被检索，或需要按关键词、查询词或语义语句查找相关内容片段时使用。',
    toolNames: ['kb_list_documents', 'kb_search']
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

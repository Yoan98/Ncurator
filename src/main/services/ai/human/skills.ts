import {
  BUILTIN_RUNTIME_SKILL_IDS,
  EXTERNAL_RUNTIME_SKILL_IDS,
  LEARNABLE_RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_IDS
} from './constants'
import type { RuntimeSkillId, SkillDefinition } from './types'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, SkillDefinition> = {
  'history-recall': {
    skillId: 'history-recall',
    familyId: 'internal',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'history-recall',
    description: '回看之前几轮已经做过的正式判断、执行动作和结果。',
    whenToUse: '当最近一轮和历史摘要还不足以定位失败模式或需要回看更早细节时使用。',
    toolNames: ['history_search', 'history_list']
  },
  'workspace-cli': {
    skillId: 'workspace-cli',
    familyId: 'terminal',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'workspace-cli',
    description: '在当前 workspace 内执行单条 CLI 命令。',
    whenToUse: '当任务需要通过命令行自主完成文件浏览、搜索、读取、验证或生成中间结果时使用。',
    toolNames: ['workspace_run_command']
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
    description: '创建或编辑 docx，包括段落、标题、表格、文本、样式调整与版本回退。',
    whenToUse:
      '当你需要新建一份 Word 文件、明确知道要改哪里改成什么，或需要撤销当前草稿修改时使用。',
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
  'kb-document-discovery': {
    skillId: 'kb-document-discovery',
    familyId: 'kb',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'kb-document-discovery',
    description: '查询当前工作区知识库中已建立了索引的文档列表。',
    whenToUse: '当需要查看工作区知识库中，有哪些文档已经能够被工作区知识库检索技能进行检索时使用。',
    toolNames: ['kb_list_documents']
  },
  'kb-evidence-query': {
    skillId: 'kb-evidence-query',
    familyId: 'kb',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'kb-evidence-query',
    description: `工作区知识库检索技能；在当前用户工作区知识库中按查询词或语句检索相关内容片段，并返回命中证据及其来源文档；
    背后是通过对文档进行分块建立的fts和向量索引来实现的，因此检索的基本单位是内容块，而不是整个文档。`,
    whenToUse: '当需要按关键词或语义语句查找用户工作区知识库中相关内容片段时使用。',
    toolNames: ['kb_search']
  }
}

export const hasSkillDefinition = (skillId: string): skillId is RuntimeSkillId =>
  RUNTIME_SKILL_IDS.includes(skillId as RuntimeSkillId)

export const isBuiltinSkillId = (skillId: string): skillId is RuntimeSkillId =>
  BUILTIN_RUNTIME_SKILL_IDS.includes(skillId as (typeof BUILTIN_RUNTIME_SKILL_IDS)[number])

export const isLearnableSkillId = (skillId: string): skillId is RuntimeSkillId =>
  LEARNABLE_RUNTIME_SKILL_IDS.includes(skillId as (typeof LEARNABLE_RUNTIME_SKILL_IDS)[number])

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

import {
  BUILTIN_RUNTIME_SKILL_IDS,
  EXTERNAL_RUNTIME_SKILL_IDS,
  LEARNABLE_RUNTIME_SKILL_IDS,
  RUNTIME_SKILL_IDS
} from './constants'
import type {
  RuntimeSkillId,
  SkillDefinition
} from './types'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, SkillDefinition> = {
  'history-recall': {
    skillId: 'history-recall',
    familyId: 'internal',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'history-recall',
    description: '回看之前几轮已经做过的正式判断、执行动作和结果。',
    whenToUse: '当最近一轮和历史摘要还不足以定位失败模式或需要回看更早细节时使用。',
    toolNames: ['history_recall']
  },
  'workspace-cli': {
    skillId: 'workspace-cli',
    familyId: 'terminal',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'workspace-cli',
    description: '读取 workspace 文件、检查环境、执行单条 CLI 命令。',
    whenToUse: '当任务必须读取工作区文件、确认目录状态、执行单条命令或生成中间文件时使用。',
    toolNames: ['terminal_run_command']
  },
  'docx-read': {
    skillId: 'docx-read',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    description: '打开 docx、定位结构、检索内容、查看版本历史。',
    whenToUse: '当任务需要阅读、定位或理解 docx 内容时使用。',
    toolNames: [
      'docx_open',
      'docx_outline',
      'docx_get_block',
      'docx_search',
      'docx_get_history'
    ]
  },
  'docx-write': {
    skillId: 'docx-write',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description: '修改 docx 内容，或回退到较早版本。',
    whenToUse: '当你已经明确知道要改哪里、改成什么，或需要撤销当前草稿修改时使用。',
    toolNames: ['docx_apply_ops', 'docx_rollback']
  },
  'kb-document-discovery': {
    skillId: 'kb-document-discovery',
    familyId: 'kb',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'kb-document-discovery',
    description: '在当前工作区知识库内缩小候选文档范围。',
    whenToUse: '当只知道主题、结果过散、或需要提高精准文档定位时使用。',
    toolNames: ['kb_list_documents']
  },
  'kb-evidence-query': {
    skillId: 'kb-evidence-query',
    familyId: 'kb',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'kb-evidence-query',
    description: '在当前工作区知识库中直接搜索内容，提取 chunk 级证据。',
    whenToUse: '当任务需要查资料怎么写、找证据、找规则、找引用或基于资料作答时使用。',
    toolNames: ['kb_hybrid_search_chunks', 'kb_vector_search_chunks', 'kb_fts_search_chunks']
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

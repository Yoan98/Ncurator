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
    availability: 'always_on',
    countsTowardToolBudget: false,
    title: 'history-recall',
    summary: '回看之前几轮已经做过的正式判断、执行动作和结果。',
    whenToUse: '当最近一轮和历史摘要还不足以定位失败模式或需要回看更早细节时使用。',
    detail:
      '它用于主动加载更详细的过程历史，不负责读取工作区或知识库。优先先看你已有的上一轮与历史链；只有确实需要查看更多旧轮次时再调用。',
    toolNames: ['history_recall']
  },
  'workspace-cli': {
    skillId: 'workspace-cli',
    familyId: 'terminal',
    source: 'external',
    availability: 'learnable',
    countsTowardToolBudget: true,
    title: 'workspace-cli',
    summary: '读取 workspace 文件、检查环境、执行单条 CLI 命令。',
    whenToUse: '当任务必须读取工作区文件、确认目录状态、执行单条命令或生成中间文件时使用。',
    detail:
      '它不是知识库问答的默认入口，也不负责 docx 结构化编辑。优先把动作收敛为单条、边界清晰、可解释的命令；如果 KB 或 docx 工具已经足够，就不要退回 terminal。',
    toolNames: ['terminal_run_command']
  },
  'docx-read': {
    skillId: 'docx-read',
    familyId: 'docx',
    source: 'external',
    availability: 'learnable',
    countsTowardToolBudget: true,
    title: 'docx-read',
    summary: '打开 docx、定位结构、检索内容、查看历史。',
    whenToUse: '当任务需要阅读、定位或理解 docx 内容时使用。',
    detail:
      '它提供 docx 的结构概览、block 级精读、全文或局部 block 检索，以及 run 内快照历史查看。outline 返回稳定 block 摘要且可能截断；get_block 返回指定 block 的完整内容；search 默认检索当前文档全部 block，也可用 scope.blockIds 缩小范围。它不负责真正写入文档。',
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
    availability: 'learnable',
    countsTowardToolBudget: true,
    title: 'docx-write',
    summary: '修改 docx 内容，或基于快照回滚到上一版。',
    whenToUse: '当你已经明确知道要改哪里、改成什么，或需要回滚当前草稿快照时使用。',
    detail:
      '它提供结构化编辑与 run 内快照回滚。replace_text 只替换现有文本；insert_before / insert_after 会新增 block 级内容；replace_block 会整块替换；update_table_cell 只更新已有表格单元格。它不负责确认副本生成、差异样式或最终落盘。',
    toolNames: ['docx_apply_ops', 'docx_rollback']
  },
  'kb-document-discovery': {
    skillId: 'kb-document-discovery',
    familyId: 'kb',
    source: 'external',
    availability: 'learnable',
    countsTowardToolBudget: true,
    title: 'kb-document-discovery',
    summary: '在当前工作区知识库内缩小候选文档范围。',
    whenToUse: '当只知道主题、结果过散、或需要提高精准文档定位时使用。',
    detail:
      '它是文档级缩圈能力，不是固定前置步骤，也不负责直接提炼事实或规则。只有在需要进一步缩小候选文档时才使用。',
    toolNames: ['kb_list_documents']
  },
  'kb-evidence-query': {
    skillId: 'kb-evidence-query',
    familyId: 'kb',
    source: 'external',
    availability: 'learnable',
    countsTowardToolBudget: true,
    title: 'kb-evidence-query',
    summary: '在当前工作区知识库中直接搜索内容，提取 chunk 级证据。',
    whenToUse: '当任务需要查资料怎么写、找证据、找规则、找引用或基于资料作答时使用。',
    detail:
      '它是当前工作区 KB 的默认搜索入口。默认优先 hybrid；需要精确术语时再用 fts，需要扩大语义召回时再用 vector。若已选资料足够明确，可带 documentIds 先缩圈；若结果不足，可扩大回当前工作区范围。',
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

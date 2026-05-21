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
    description:
      '能力：在当前 workspace 边界内执行单条终端命令。\n结果：返回命令输出、退出状态和可识别的工作区文件产物。\n边界：命令的直接执行、并行安全与审批要求由终端命令策略决定。',
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
      '能力：读取 sourcePath 对应 docx 的结构、内容块、检索结果和任务内修订历史。\n结果：返回块级索引、正文内容、匹配信息或 revision 信息。\n边界：只读取 docx 内容与修订状态，不改变草稿内容。',
    whenToUse: '适用于需要读取或理解 docx 内容与修订状态的任务。',
    toolNames: ['docx_outline', 'docx_search', 'docx_read_blocks', 'docx_history']
  },
  'docx-write': {
    skillId: 'docx-write',
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    description: `能力：创建 docx 文件内容，插入段落、标题、表格，替换文本，调整文本样式，删除完整块，切换编辑 revision。\n结果：生成新的 docx 编辑 revision，并返回变更信息与写后回读信息。\n边界：写入作用于当前任务内的编辑链路，最终落盘由 review / commit 链路处理；单轮连续 docx 写操作最多只能规划 ${HUMAN_DOCX_BATCH_WRITE_LIMIT} 个。`,
    whenToUse: '适用于需要改变 docx 内容或编辑 revision 状态的任务。',
    toolNames: [
      'docx_create',
      'docx_paragraph_edit',
      'docx_heading_edit',
      'docx_table_edit',
      'docx_text_edit',
      'docx_text_style_edit',
      'docx_delete',
      'docx_rollback'
    ]
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

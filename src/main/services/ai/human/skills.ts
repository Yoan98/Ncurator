import { RUNTIME_SKILL_IDS } from './constants'
import type { RuntimeSkillId, SkillCatalogItem, SkillDefinition } from './types'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, SkillDefinition> = {
  'workspace-cli': {
    skillId: 'workspace-cli',
    familyId: 'terminal',
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
    title: 'docx-read',
    summary: '打开 docx、定位结构、检索内容、查看历史。',
    whenToUse: '当任务需要阅读、定位或理解 docx 内容时使用。',
    detail:
      '先 open，再按需要 outline、search、get_block 或 history。它适合定位内容和理解结构，不负责真正写入文档。',
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
    title: 'docx-write',
    summary: '修改 docx 内容，或基于快照回滚到上一版。',
    whenToUse: '当你已经明确知道要改哪里、改成什么，或需要回滚当前草稿快照时使用。',
    detail:
      '进入写入前应先定位到目标内容，并确认参数结构。对 replace_text，最小合法结构是 type/query/replace；修改后通常还需要 preview、validate 或 save 来完成交付。',
    toolNames: ['docx_apply_ops', 'docx_rollback']
  },
  'docx-delivery': {
    skillId: 'docx-delivery',
    familyId: 'docx',
    title: 'docx-delivery',
    summary: '校验 docx 草稿、生成预览、按需落盘。',
    whenToUse: '当文档内容已经准备好，需要形成可审阅或可交付结果时使用。',
    detail:
      '优先用 validate 和 render_preview 做检查与交付；只有任务明确需要文件落盘时才 save。',
    toolNames: ['docx_render_preview', 'docx_save', 'docx_validate']
  },
  'kb-document-discovery': {
    skillId: 'kb-document-discovery',
    familyId: 'kb',
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

export const buildSkillCatalog = (): SkillCatalogItem[] =>
  listSkillDefinitions().map((definition) => ({
    skillId: definition.skillId,
    familyId: definition.familyId,
    title: definition.title,
    summary: definition.summary,
    toolNames: [...definition.toolNames],
    whenToUse: definition.whenToUse
  }))

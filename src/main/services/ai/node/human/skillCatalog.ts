import type { StructuredToolInterface } from '@langchain/core/tools'
import { RUNTIME_SKILL_IDS } from '../../../../../shared/constants'
import type { RuntimeSkillId, SkillCard } from '../../../../../shared/types'
import { docxCapability } from '../../tools/docx'
import { localKbRetrievalCapability } from '../../tools/local_kb_retrieval'
import { terminalExecCapability } from '../../tools/terminal_exec'
import type { CapabilityToolBuildInput } from '../../tools/types'
import type { LoadedSkill } from './types'

type HumanSkillGuide = {
  summary: string
  workflow: string[]
  decisionHints: string[]
}

type HumanSkillDefinition = {
  card: SkillCard
  guide: HumanSkillGuide
  buildTools: (input: CapabilityToolBuildInput) => StructuredToolInterface[]
}

export const ACTIVE_HUMAN_SKILL_LIMIT = 2

const skillDefinitions: Record<RuntimeSkillId, HumanSkillDefinition> = {
  'workspace-shell': {
    card: {
      id: 'workspace-shell',
      name: 'Workspace Shell',
      summary: '读取 workspace 文件、检查环境或执行单条命令，并接住命令产物。',
      whenToLoad: '只有当 KB 或 DOCX 工具不能直接完成任务，且确实需要 shell 读取、验证或生成文件时。',
      workflow: [
        '先明确要读什么文件或要执行什么单条命令。',
        '必要时设置 cwd，并把命令收敛到当前任务的最小范围。',
        '检查 outputPreview / artifacts，再决定交付或切换技能。'
      ],
      avoidWhen: [
        '不要把 shell 当成 KB 检索的替代品。',
        '不要把 shell 当成 DOCX 编辑的默认入口。'
      ],
      toolNames: ['terminal_run_command'],
      requires: ['workspace']
    },
    guide: {
      summary: 'Shell 能补足 workspace 读取、环境检查和中间文件生成，但风险高于专用工具。',
      workflow: [
        '优先用单条命令读取事实。',
        '若命令会生成文件，提前声明 expectedArtifacts。',
        '拿到输出或产物后尽快收敛，不要连续探测环境。'
      ],
      decisionHints: [
        '命中 approval_denied 或 workspace_required 后不要重复同一命令。',
        '已有足够本地证据时，优先 complete_task，而不是继续跑 shell 复核。'
      ]
    },
    buildTools: terminalExecCapability.buildTools
  },
  'docx-editing': {
    card: {
      id: 'docx-editing',
      name: 'DOCX Editing',
      summary: '打开、定位、编辑、预览、校验并按需保存 docx 草稿。',
      whenToLoad: '任务明确要求读取或修改 .docx 文档、生成 preview、或输出新的 docx 文件时。',
      workflow: [
        'open 文档拿到 docId。',
        '按需要用 outline/search/get_block 定位，或直接 apply_ops 编辑。',
        '编辑后优先 render_preview / validate；只有明确要求落盘时再 save。'
      ],
      avoidWhen: [
        '如果任务只是知识问答，不要加载 docx-editing。',
        'preview / handoff 任务不要默认扩展成 save。'
      ],
      toolNames: [
        'docx_open',
        'docx_outline',
        'docx_get_block',
        'docx_search',
        'docx_apply_ops',
        'docx_get_history',
        'docx_rollback',
        'docx_save',
        'docx_render_preview',
        'docx_validate'
      ],
      requires: ['workspace']
    },
    guide: {
      summary: 'DOCX 编辑能力的核心是围绕 docId 快照工作，而不是直接覆盖磁盘文件。',
      workflow: [
        '所有 docx_* 工具都以 open 或当前最新 docId 为起点。',
        'apply_ops 会产生新的不可变 docId；后续步骤默认跟随最新快照。',
        'preview/validate 是默认收敛路径，save 只在任务明确要求落盘时使用。'
      ],
      decisionHints: [
        '已知明确原文时可直接 replace_text，不必先 outline/search。',
        '需要稳定 blockId 时先 outline，再 get_block 或 apply_ops。',
        '文档改坏时先看 history/rollback，而不是直接重新 open 重做。'
      ]
    },
    buildTools: docxCapability.buildTools
  },
  'local-kb-retrieval': {
    card: {
      id: 'local-kb-retrieval',
      name: 'Local KB Retrieval',
      summary: '在本地知识库上做 chunk 检索与文档发现，并把结果收敛成可引用证据。',
      whenToLoad: '任务需要先从已导入的本地资料中查证事实、缩小文档范围或获得引用依据时。',
      workflow: [
        '优先做 hybrid search。',
        '若范围不清或结果为空，再改写 query 或列文档。',
        '拿到足够证据后尽快完成，不要重复检索同一事实。'
      ],
      avoidWhen: [
        '不要用 KB 工具替代 workspace 文件读取。',
        'selectedDocumentIds 已固定且已有命中文档时，不要再 list_documents 重复确认范围。'
      ],
      toolNames: [
        'kb_hybrid_search_chunks',
        'kb_vector_search_chunks',
        'kb_fts_search_chunks',
        'kb_list_documents'
      ]
    },
    guide: {
      summary: '本地 KB 的目标是给出可回看的 chunk 证据，而不是无限召回更多结果。',
      workflow: [
        '默认 hybrid first。',
        '需要更宽松语义时再 vector；需要精确关键词时再 fts。',
        '只有在 search 结果不足或范围不清时，才 list_documents。'
      ],
      decisionHints: [
        '若 observation 已包含 document_id/document_name 和直接证据，优先收敛。',
        'documentIds 只用于缩小范围，不能逃出当前 selectedDocumentIds。'
      ]
    },
    buildTools: localKbRetrievalCapability.buildTools
  }
}

export const buildAvailableSkillCards = (): SkillCard[] =>
  RUNTIME_SKILL_IDS.map((skillId) => {
    const card = skillDefinitions[skillId].card
    return {
      ...card,
      workflow: [...card.workflow],
      avoidWhen: card.avoidWhen ? [...card.avoidWhen] : undefined,
      toolNames: [...card.toolNames],
      requires: card.requires ? [...card.requires] : undefined
    }
  })

export const getSkillDefinition = (skillId: RuntimeSkillId): HumanSkillDefinition => {
  return skillDefinitions[skillId]
}

export const buildLoadedSkill = (skillId: RuntimeSkillId, step: number): LoadedSkill => {
  const definition = getSkillDefinition(skillId)
  return {
    skillId,
    name: definition.card.name,
    summary: definition.guide.summary,
    workflow: [...definition.guide.workflow],
    decisionHints: [...definition.guide.decisionHints],
    toolNames: [...definition.card.toolNames],
    loadedAtStep: step
  }
}

export const buildSkillTools = (
  skillId: RuntimeSkillId,
  input: CapabilityToolBuildInput
): StructuredToolInterface[] => {
  return getSkillDefinition(skillId).buildTools(input)
}

export const buildActiveTools = (input: {
  activeSkillIds: RuntimeSkillId[]
  loadedToolsets: Partial<Record<RuntimeSkillId, StructuredToolInterface[]>>
}): StructuredToolInterface[] => {
  const ordered: StructuredToolInterface[] = []
  const seen = new Set<string>()

  for (const skillId of input.activeSkillIds) {
    const tools = input.loadedToolsets[skillId] || []
    for (const tool of tools) {
      const name = String(tool.name || '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      ordered.push(tool)
    }
  }

  return ordered
}

export const activateSkillIds = (input: {
  skillId: RuntimeSkillId
  activeSkillIds: RuntimeSkillId[]
}): RuntimeSkillId[] => {
  return [input.skillId, ...input.activeSkillIds.filter((item) => item !== input.skillId)].slice(
    0,
    ACTIVE_HUMAN_SKILL_LIMIT
  )
}

import type { StructuredToolInterface } from '@langchain/core/tools'
import { RUNTIME_SKILL_IDS } from '../../../../../shared/constants'
import {
  type RuntimeSkillId,
  type SkillCard
} from '../../../../../shared/types'
import { docxCapability } from '../../tools/docx'
import { localKbRetrievalCapability } from '../../tools/local_kb_retrieval'
import { terminalExecCapability } from '../../tools/terminal_exec'
import type { CapabilityToolBuildInput } from '../../tools/types'
import type { LoadedSkill } from './types'

type HumanSkillDefinition = {
  card: SkillCard
  skillContent: string
  referencedAssets: string[]
  toolNames: string[]
  buildTools: (input: CapabilityToolBuildInput) => StructuredToolInterface[]
}

export const ACTIVE_HUMAN_SKILL_LIMIT = 2

const skillDefinitions: Record<RuntimeSkillId, HumanSkillDefinition> = {
  'workspace-shell': {
    card: {
      id: 'workspace-shell',
      name: 'Workspace Shell',
      summary: '读取、检查并修改 workspace 文件，必要时执行单条终端命令。',
      whenToUse: '需要看本地文件、跑命令、验证输出或生成文件时。',
      unlocks: ['terminal_run_command'],
      requires: ['workspace']
    },
    skillContent: [
      '能力说明：使用 workspace 内的 shell 命令读取文件、检查环境或执行有限修改。',
      '工具：terminal_run_command({ command, cwd?, expectedArtifacts? })',
      '使用提示：',
      '- 一次只执行一个明确命令，并把命令限制在当前任务需要的最小范围。',
      '- 优先读取和验证，再执行会改动文件系统的命令。',
      '- 命中审批或缺失 workspace 时，不要重试相同命令。'
    ].join('\n'),
    referencedAssets: ['src/main/services/ai/tools/terminal_exec'],
    toolNames: ['terminal_run_command'],
    buildTools: terminalExecCapability.buildTools
  },
  'docx-editing': {
    card: {
      id: 'docx-editing',
      name: 'DOCX Editing',
      summary: '打开、定位、编辑、预览、校验并保存 docx 文档。',
      whenToUse: '需要读取或修改 Word 文档结构、正文和导出文件时。',
      unlocks: [
        'docx_open',
        'docx_outline',
        'docx_get_block',
        'docx_search',
        'docx_apply_ops',
        'docx_render_preview',
        'docx_save',
        'docx_validate'
      ],
      requires: ['workspace']
    },
    skillContent: [
      '能力说明：处理 workspace 中的 docx 文件，按 open -> inspect/search -> apply -> save/validate 的顺序执行。',
      '关键参数：docx_open({ sourcePath })；docx_search({ docId, query, mode })；docx_apply_ops({ docId, ops })；docx_save({ docId, outPath })；docx_validate({ docId })。',
      'replace_text 操作示例：{ type: "replace_text", query: "Hello", replace: "Hi", replaceAll: true }。',
      '工具：docx_open, docx_outline, docx_get_block, docx_search, docx_apply_ops, docx_render_preview, docx_save, docx_validate',
      '使用提示：',
      '- 先 open 获取 docId，再基于 docId 继续搜索、编辑和保存。',
      '- 执行 apply_ops 后通常会得到新的 docId，后续步骤应使用最新 docId。',
      '- 保存前优先搜索或预览，保存后优先 validate。'
    ].join('\n'),
    referencedAssets: [
      'src/main/services/ai/tools/docx',
      'src/main/services/ai/tools/docx/adapters/ooxml'
    ],
    toolNames: [
      'docx_open',
      'docx_outline',
      'docx_get_block',
      'docx_search',
      'docx_apply_ops',
      'docx_render_preview',
      'docx_save',
      'docx_validate'
    ],
    buildTools: docxCapability.buildTools
  },
  'local-kb-retrieval': {
    card: {
      id: 'local-kb-retrieval',
      name: 'Local KB Retrieval',
      summary: '在本地知识库中做 hybrid/vector/FTS 检索并列出文档。',
      whenToUse: '需要从已导入的本地文档中查证事实或缩小搜索范围时。',
      unlocks: [
        'kb_hybrid_search_chunks',
        'kb_vector_search_chunks',
        'kb_fts_search_chunks',
        'kb_list_documents'
      ]
    },
    skillContent: [
      '能力说明：在本地知识库中检索片段或列出文档，优先用 hybrid 搜索做初步召回。',
      '关键参数：kb_*_search_chunks({ queryText, limit?, sourceType?, documentIds? })；kb_list_documents({ page?, pageSize?, sourceType?, documentIds? })。',
      '工具：kb_hybrid_search_chunks, kb_vector_search_chunks, kb_fts_search_chunks, kb_list_documents',
      '使用提示：',
      '- 先用 kb_hybrid_search_chunks；只有在需要更强语义或关键词控制时再切换 vector / fts。',
      '- 结果为空时，可以改写 queryText 或列出文档核对范围。',
      '- 返回结果通常是数组；完成任务前要从结果中提炼明确证据。'
    ].join('\n'),
    referencedAssets: ['src/main/services/ai/tools/local_kb_retrieval'],
    toolNames: [
      'kb_hybrid_search_chunks',
      'kb_vector_search_chunks',
      'kb_fts_search_chunks',
      'kb_list_documents'
    ],
    buildTools: localKbRetrievalCapability.buildTools
  }
}

export const buildAvailableSkillCards = (): SkillCard[] =>
  RUNTIME_SKILL_IDS.map((skillId) => ({ ...skillDefinitions[skillId].card }))

export const getSkillDefinition = (skillId: RuntimeSkillId): HumanSkillDefinition => {
  return skillDefinitions[skillId]
}

export const buildLoadedSkill = (skillId: RuntimeSkillId, step: number): LoadedSkill => {
  const definition = getSkillDefinition(skillId)
  return {
    skillId,
    skillContent: definition.skillContent,
    referencedAssets: [...definition.referencedAssets],
    toolNames: [...definition.toolNames],
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

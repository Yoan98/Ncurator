import type { JsonObject } from '../../../../../shared/types'
import type { RuntimeSkillId } from '../types'
import { DOCX_TOOL_PROMPT_SPECS } from '../prompts/toolPromptSpecs/docx'
import { KB_TOOL_PROMPT_SPECS } from '../prompts/toolPromptSpecs/kb'
import { TERMINAL_TOOL_PROMPT_SPECS } from '../prompts/toolPromptSpecs/terminal'
import type { AiToolFamilyId, ToolDescriptor, ToolExecutionMeta } from './types'
import {
  classifyCommandMode,
  classifyCommandRisk,
  collectTerminalArtifactCandidates
} from './terminal/terminalPolicy'

const readStringArg = (args: JsonObject, key: string): string | undefined => {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const createStaticExecutionMetaResolver = (input: {
  mutability: ToolExecutionMeta['mutability']
  parallelSafe: boolean
  getResourceKey?: (args: JsonObject) => string | undefined
  defaultResourceKey?: string
}) => {
  return (args: JsonObject): ToolExecutionMeta => ({
    mutability: input.mutability,
    parallelSafe: input.parallelSafe,
    resourceKey: input.getResourceKey?.(args) || input.defaultResourceKey
  })
}

const resolveTerminalExecutionMeta = (args: JsonObject): ToolExecutionMeta => {
  const command = readStringArg(args, 'command') || ''
  const risk = classifyCommandRisk(command)
  const commandMode = classifyCommandMode(command)
  const artifacts = collectTerminalArtifactCandidates(command)
  const resourceKey = readStringArg(args, 'cwd') || 'workspace'

  if (risk === 'low' && commandMode === 'read_only' && artifacts.length === 0) {
    return {
      mutability: 'read_only',
      parallelSafe: true,
      resourceKey
    }
  }

  return {
    mutability: 'mutating',
    parallelSafe: false,
    resourceKey
  }
}

export const TOOL_CATALOG: readonly ToolDescriptor[] = [
  {
    name: 'terminal_run_command',
    familyId: 'terminal',
    skillIds: ['workspace-cli'],
    requiresWorkspace: true,
    promptSpec: TERMINAL_TOOL_PROMPT_SPECS.terminal_run_command,
    resolveExecutionMeta: resolveTerminalExecutionMeta
  },
  {
    name: 'kb_hybrid_search_chunks',
    familyId: 'kb',
    skillIds: ['kb-evidence-query'],
    requiresWorkspace: false,
    promptSpec: KB_TOOL_PROMPT_SPECS.kb_hybrid_search_chunks,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      defaultResourceKey: 'local-kb'
    })
  },
  {
    name: 'kb_vector_search_chunks',
    familyId: 'kb',
    skillIds: ['kb-evidence-query'],
    requiresWorkspace: false,
    promptSpec: KB_TOOL_PROMPT_SPECS.kb_vector_search_chunks,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      defaultResourceKey: 'local-kb'
    })
  },
  {
    name: 'kb_fts_search_chunks',
    familyId: 'kb',
    skillIds: ['kb-evidence-query'],
    requiresWorkspace: false,
    promptSpec: KB_TOOL_PROMPT_SPECS.kb_fts_search_chunks,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      defaultResourceKey: 'local-kb'
    })
  },
  {
    name: 'kb_list_documents',
    familyId: 'kb',
    skillIds: ['kb-document-discovery'],
    requiresWorkspace: false,
    promptSpec: KB_TOOL_PROMPT_SPECS.kb_list_documents,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      defaultResourceKey: 'local-kb'
    })
  },
  {
    name: 'docx_open',
    familyId: 'docx',
    skillIds: ['docx-read'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_open,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'mutating',
      parallelSafe: false,
      getResourceKey: (args) => readStringArg(args, 'sourcePath'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_outline',
    familyId: 'docx',
    skillIds: ['docx-read'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_outline,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_get_block',
    familyId: 'docx',
    skillIds: ['docx-read'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_get_block,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_search',
    familyId: 'docx',
    skillIds: ['docx-read'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_search,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_get_history',
    familyId: 'docx',
    skillIds: ['docx-read'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_get_history,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_apply_ops',
    familyId: 'docx',
    skillIds: ['docx-write'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_apply_ops,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'mutating',
      parallelSafe: false,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_rollback',
    familyId: 'docx',
    skillIds: ['docx-write'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_rollback,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'mutating',
      parallelSafe: false,
      getResourceKey: (args) => readStringArg(args, 'docId') || readStringArg(args, 'targetDocId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_render_preview',
    familyId: 'docx',
    skillIds: ['docx-delivery'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_render_preview,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'mutating',
      parallelSafe: false,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_save',
    familyId: 'docx',
    skillIds: ['docx-delivery'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_save,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'mutating',
      parallelSafe: false,
      getResourceKey: (args) => readStringArg(args, 'outPath') || readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  },
  {
    name: 'docx_validate',
    familyId: 'docx',
    skillIds: ['docx-delivery'],
    requiresWorkspace: true,
    promptSpec: DOCX_TOOL_PROMPT_SPECS.docx_validate,
    resolveExecutionMeta: createStaticExecutionMetaResolver({
      mutability: 'read_only',
      parallelSafe: true,
      getResourceKey: (args) => readStringArg(args, 'docId'),
      defaultResourceKey: 'docx'
    })
  }
]

const TOOL_DESCRIPTOR_BY_NAME = new Map(
  TOOL_CATALOG.map((descriptor) => [descriptor.name, descriptor] as const)
)

const TOOL_DESCRIPTORS_BY_FAMILY = new Map<AiToolFamilyId, ToolDescriptor[]>()
const TOOL_DESCRIPTORS_BY_SKILL = new Map<RuntimeSkillId, ToolDescriptor[]>()

TOOL_CATALOG.forEach((descriptor) => {
  const familyDescriptors = TOOL_DESCRIPTORS_BY_FAMILY.get(descriptor.familyId) || []
  familyDescriptors.push(descriptor)
  TOOL_DESCRIPTORS_BY_FAMILY.set(descriptor.familyId, familyDescriptors)

  descriptor.skillIds.forEach((skillId) => {
    const skillDescriptors = TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || []
    skillDescriptors.push(descriptor)
    TOOL_DESCRIPTORS_BY_SKILL.set(skillId, skillDescriptors)
  })
})

export const getToolDescriptor = (toolName: string): ToolDescriptor | undefined =>
  TOOL_DESCRIPTOR_BY_NAME.get(toolName)

export const listToolDescriptors = (): ToolDescriptor[] => [...TOOL_CATALOG]

export const listToolDescriptorsByFamily = (familyId: AiToolFamilyId): ToolDescriptor[] =>
  [...(TOOL_DESCRIPTORS_BY_FAMILY.get(familyId) || [])]

export const listToolNamesByFamily = (familyId: AiToolFamilyId): string[] =>
  listToolDescriptorsByFamily(familyId).map((descriptor) => descriptor.name)

export const listToolDescriptorsBySkill = (skillId: RuntimeSkillId): ToolDescriptor[] =>
  [...(TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || [])]

export const listToolNamesBySkill = (skillId: RuntimeSkillId): string[] =>
  listToolDescriptorsBySkill(skillId).map((descriptor) => descriptor.name)

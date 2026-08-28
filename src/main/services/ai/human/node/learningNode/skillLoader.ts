import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../../types'
import type { AiToolFamilyId, ToolFamilyBuildInput } from '../../tools/types'
import { TOOL_FAMILY_DEFINITIONS } from '../../tools'
import type { HumanRuntimeCache, RuntimeSkillId } from '../../types'
import { getEffectiveLearnedSkillIds, getSkillDefinition } from '../../skills'
import { attachProviderToolDefinitions } from '../../tools/utils/toolSchemaSerialization'

const TOOL_FAMILY_BUILDERS: Record<
  AiToolFamilyId,
  (input: ToolFamilyBuildInput) => StructuredToolInterface[]
> = {
  terminal: TOOL_FAMILY_DEFINITIONS.terminal.buildTools,
  'text-file': TOOL_FAMILY_DEFINITIONS['text-file'].buildTools,
  kb: TOOL_FAMILY_DEFINITIONS.kb.buildTools,
  docx: TOOL_FAMILY_DEFINITIONS.docx.buildTools,
  pdf: TOOL_FAMILY_DEFINITIONS.pdf.buildTools,
  ppt: TOOL_FAMILY_DEFINITIONS.ppt.buildTools,
  excel: TOOL_FAMILY_DEFINITIONS.excel.buildTools,
  web: TOOL_FAMILY_DEFINITIONS.web.buildTools,
  'image-generation': TOOL_FAMILY_DEFINITIONS['image-generation'].buildTools,
  'agent-control': TOOL_FAMILY_DEFINITIONS['agent-control'].buildTools
}

const ensureFamilyTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  familyId: AiToolFamilyId
}): StructuredToolInterface[] => {
  const cached = input.cache.familyToolsets[input.familyId]
  if (cached) return cached

  const built = TOOL_FAMILY_BUILDERS[input.familyId]({
    ctx: input.ctx,
    cache: input.cache,
    runId: input.runId,
    sessionId: input.ctx.sessionId,
    taskId: input.taskId
  })
  attachProviderToolDefinitions(built)
  input.cache.familyToolsets[input.familyId] = built
  return built
}

export const ensureSkillTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  skillId: RuntimeSkillId
}): StructuredToolInterface[] => {
  const cached = input.cache.skillToolsets[input.skillId]
  if (cached) return cached

  const definition = getSkillDefinition(input.skillId)
  const familyTools = ensureFamilyTools({
    cache: input.cache,
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    familyId: definition.familyId
  })
  const skillToolNames = new Set(definition.toolNames)
  const built = familyTools.filter((tool) => skillToolNames.has(String(tool.name || '').trim()))
  input.cache.skillToolsets[input.skillId] = built
  return built
}

export const buildAvailableTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  learnedSkillIds: RuntimeSkillId[]
}): StructuredToolInterface[] => {
  const tools: StructuredToolInterface[] = []
  const seenNames = new Set<string>()
  getEffectiveLearnedSkillIds(input.learnedSkillIds).forEach((skillId) => {
    for (const tool of ensureSkillTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      skillId
    })) {
      const name = String(tool.name || '').trim()
      if (!name || seenNames.has(name)) continue
      seenNames.add(name)
      tools.push(tool)
    }
  })
  return tools
}

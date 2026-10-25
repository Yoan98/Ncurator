import { isToolAllowed } from '../../../run/toolPolicy'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../../types'
import type { AiToolFamilyId, ToolFamilyBuildInput } from '../../tools/types'
import { TOOL_FAMILY_DEFINITIONS } from '../../tools'
import type { HumanRuntimeCache, RuntimeToolsetId } from '../../types'
import { getEffectiveLoadedToolsetIds, getToolsetDefinition } from '../../toolsets'
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
  'agent-control': TOOL_FAMILY_DEFINITIONS['agent-control'].buildTools,
  'scheduled-tasks': TOOL_FAMILY_DEFINITIONS['scheduled-tasks'].buildTools,
  'skill-management': TOOL_FAMILY_DEFINITIONS['skill-management'].buildTools
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
    partnerId: input.ctx.partnerId,
    taskId: input.taskId
  }).filter((tool) => isToolAllowed(input.ctx, tool.name))
  attachProviderToolDefinitions(built)
  input.cache.familyToolsets[input.familyId] = built
  return built
}

export const ensureToolsetTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  toolsetId: RuntimeToolsetId
}): StructuredToolInterface[] => {
  const cached = input.cache.toolsetTools[input.toolsetId]
  if (cached) return cached

  const definition = getToolsetDefinition(input.toolsetId)
  const familyTools = ensureFamilyTools({
    cache: input.cache,
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    familyId: definition.familyId
  })
  const toolsetToolNames = new Set(definition.toolNames)
  const built = familyTools.filter((tool) => toolsetToolNames.has(String(tool.name || '').trim()))
  input.cache.toolsetTools[input.toolsetId] = built
  return built
}

export const buildAvailableTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  loadedToolsetIds: RuntimeToolsetId[]
}): StructuredToolInterface[] => {
  const tools: StructuredToolInterface[] = []
  const seenNames = new Set<string>()
  getEffectiveLoadedToolsetIds(input.loadedToolsetIds).forEach((toolsetId) => {
    for (const tool of ensureToolsetTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      toolsetId
    })) {
      const name = String(tool.name || '').trim()
      if (!name || seenNames.has(name)) continue
      seenNames.add(name)
      tools.push(tool)
    }
  })
  return tools
}

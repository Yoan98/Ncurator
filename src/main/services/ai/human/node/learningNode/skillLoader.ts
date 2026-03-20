import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../../types'
import type { AiToolFamilyId, ToolFamilyBuildInput } from '../../tools/types'
import { docxToolFamily } from '../../tools/docx'
import { kbToolFamily } from '../../tools/kb'
import { terminalToolFamily } from '../../tools/terminal'
import type { HumanRuntimeCache, RuntimeSkillId } from '../../types'
import { getSkillDefinition } from './skillRegistry'

const TOOL_FAMILY_BUILDERS: Record<
  AiToolFamilyId,
  (input: ToolFamilyBuildInput) => StructuredToolInterface[]
> = {
  terminal: terminalToolFamily.buildTools,
  kb: kbToolFamily.buildTools,
  docx: docxToolFamily.buildTools
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
    runId: input.runId,
    taskId: input.taskId
  })
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
  const allowedToolNames = new Set(definition.toolNames)
  const built = familyTools.filter((tool) => allowedToolNames.has(String(tool.name || '').trim()))
  input.cache.skillToolsets[input.skillId] = built
  return built
}

export const getAvailableToolNames = (input: {
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): string[] => {
  const toolNames = new Set<string>()
  input.learnedSkillIds.forEach((skillId) => {
    ;(input.cache.skillToolsets[skillId] || []).forEach((tool) => {
      const toolName = String(tool.name || '').trim()
      if (toolName) toolNames.add(toolName)
    })
  })
  return Array.from(toolNames)
}

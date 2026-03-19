import type { StructuredToolInterface } from '@langchain/core/tools'
import type { RuntimeSkillId } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { activateSkillIds, buildSkillTools } from '../registry/skills'
import type { HumanRuntimeCache, HumanState } from './state'

export const getActiveSkillIds = (state: HumanState): RuntimeSkillId[] => {
  return [...state.memory.capabilityFocus.activeStack]
}

export const ensureRuntimeSkillTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  skillId: RuntimeSkillId
}): StructuredToolInterface[] => {
  const cached = input.cache.toolsets[input.skillId]
  if (cached) return cached
  const built = buildSkillTools(input.skillId, {
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })
  input.cache.toolsets[input.skillId] = built
  return built
}

export const getActiveTools = (input: {
  state: HumanState
  cache: HumanRuntimeCache
}): StructuredToolInterface[] => {
  const ordered: StructuredToolInterface[] = []
  const seen = new Set<string>()
  for (const skillId of input.state.memory.capabilityFocus.activeStack) {
    const tools = input.cache.toolsets[skillId] || []
    for (const tool of tools) {
      const toolName = String(tool.name || '').trim()
      if (!toolName || seen.has(toolName)) continue
      seen.add(toolName)
      ordered.push(tool)
    }
  }
  return ordered
}

export const getActiveToolNames = (input: {
  state: HumanState
  cache: HumanRuntimeCache
}): string[] => {
  return getActiveTools(input)
    .map((tool) => String(tool.name || '').trim())
    .filter(Boolean)
}

export const activateCapabilityStack = (input: {
  skillId: RuntimeSkillId
  current: RuntimeSkillId[]
}): RuntimeSkillId[] => {
  return activateSkillIds({
    skillId: input.skillId,
    activeSkillIds: input.current
  })
}

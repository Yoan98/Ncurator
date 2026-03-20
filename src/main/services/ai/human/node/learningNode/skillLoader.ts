import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, RuntimeSkillId } from '../../types'
import { buildSkillTools } from './skillRegistry'
import { docxCapability } from '../../tools/docx'

const DOCX_READ_TOOL_NAMES = new Set([
  'docx_open',
  'docx_outline',
  'docx_get_block',
  'docx_search',
  'docx_get_history'
])
const DOCX_WRITE_TOOL_NAMES = new Set(['docx_apply_ops', 'docx_rollback'])
const DOCX_DELIVERY_TOOL_NAMES = new Set(['docx_validate', 'docx_render_preview', 'docx_save'])

const ensureDocxToolsets = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
}): void => {
  if (
    input.cache.toolsets['docx-read'] &&
    input.cache.toolsets['docx-write'] &&
    input.cache.toolsets['docx-delivery']
  ) {
    return
  }

  const tools = docxCapability.buildTools({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId
  })
  input.cache.toolsets['docx-read'] = tools.filter((tool) =>
    DOCX_READ_TOOL_NAMES.has(String(tool.name || ''))
  )
  input.cache.toolsets['docx-write'] = tools.filter((tool) =>
    DOCX_WRITE_TOOL_NAMES.has(String(tool.name || ''))
  )
  input.cache.toolsets['docx-delivery'] = tools.filter((tool) =>
    DOCX_DELIVERY_TOOL_NAMES.has(String(tool.name || ''))
  )
}

export const ensureSkillTools = (input: {
  cache: HumanRuntimeCache
  ctx: AiRunContext
  runId: string
  taskId: string
  skillId: RuntimeSkillId
}): StructuredToolInterface[] => {
  if (
    input.skillId === 'docx-read' ||
    input.skillId === 'docx-write' ||
    input.skillId === 'docx-delivery'
  ) {
    ensureDocxToolsets(input)
    return input.cache.toolsets[input.skillId] || []
  }

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

export const getAvailableToolNames = (input: {
  learnedSkillIds: RuntimeSkillId[]
  cache: HumanRuntimeCache
}): string[] => {
  const toolNames = new Set<string>()
  input.learnedSkillIds.forEach((skillId) => {
    ;(input.cache.toolsets[skillId] || []).forEach((tool) => {
      const toolName = String(tool.name || '').trim()
      if (toolName) toolNames.add(toolName)
    })
  })
  return Array.from(toolNames)
}

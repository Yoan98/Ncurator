import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import { AI_TOOL_FAMILY_IDS } from '../constants'
import type { RuntimeSkillId, ToolPromptSpec } from '../types'

export type AiToolFamilyId = (typeof AI_TOOL_FAMILY_IDS)[number]

export type ToolFamilyBuildInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
}

export type ToolFamilyBuilder = (input: ToolFamilyBuildInput) => StructuredToolInterface[]

export type ToolFamilyDefinition = {
  familyId: AiToolFamilyId
  buildTools: ToolFamilyBuilder
}

export type ToolExecutionMeta = {
  mutability: 'read_only' | 'mutating'
  parallelSafe: boolean
  resourceKey?: string
}

export type ToolExecutionMetaResolver = (args: JsonObject) => ToolExecutionMeta

export type CapabilityActivityStatus = 'started' | 'completed' | 'failed'

export type CapabilityActivityInput = {
  actionType: string
  status: CapabilityActivityStatus
  summary: string
}

export type WorkspaceCapabilityBuildInput<TContext = AiRunContext> = {
  ctx: TContext
  runId: string
  taskId: string
  workspaceRootPath: string
  emitActivity: (input: CapabilityActivityInput) => void
}

export type ToolDescriptor = {
  name: string
  familyId: AiToolFamilyId
  skillIds: RuntimeSkillId[]
  requiresWorkspace: boolean
  promptSpec: ToolPromptSpec
  resolveExecutionMeta: ToolExecutionMetaResolver
}

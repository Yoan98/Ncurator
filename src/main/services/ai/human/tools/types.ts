import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import type { z } from 'zod/v4'
import { AI_TOOL_FAMILY_IDS } from '../constants'
import type { HumanRuntimeCache, RuntimeSkillId, ToolPromptSpec } from '../types'

export type AiToolFamilyId = (typeof AI_TOOL_FAMILY_IDS)[number]

export type ToolFamilyBuildInput = {
  ctx: AiRunContext
  cache: HumanRuntimeCache
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
  cache: HumanRuntimeCache
  runId: string
  taskId: string
  workspaceRootPath: string
  emitActivity: (input: CapabilityActivityInput) => void
}

export type HumanToolSpec<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = {
  name: TName
  familyId: AiToolFamilyId
  skillIds: TSkillId[]
  requiresWorkspace: boolean
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  promptSpec: ToolPromptSpec
  resolveExecutionMeta: ToolExecutionMetaResolver
}

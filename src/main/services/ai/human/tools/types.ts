import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { RuntimeToolName } from '../../../../../shared/runtimeCapabilities'
import type { AiRunContext } from '../../types'
import type { z } from 'zod/v4'
import { AI_TOOL_FAMILY_IDS } from '../constants'
import type { HumanRuntimeCache, RuntimeSkillId, ToolPromptSpec } from '../types'

export type AiToolFamilyId = (typeof AI_TOOL_FAMILY_IDS)[number]

export type ToolFamilyBuildInput = {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  runId: string
  partnerId: string
  taskId: string
}

export type ToolFamilyBuilder = (input: ToolFamilyBuildInput) => StructuredToolInterface[]

export type ToolFamilyDefinition = {
  familyId: AiToolFamilyId
  buildTools: ToolFamilyBuilder
}

export type ToolExecutionMeta = {
  mutability: 'read_only' | 'mutating'
  resourceKey?: string
}

export type ToolExecutionMetaResolver = (args: JsonObject) => ToolExecutionMeta

export type ModelResultRendererInput = {
  toolName: string
  args: JsonObject
  data: JsonValue | undefined
}

export type ModelResultRenderer = (input: ModelResultRendererInput) => string

export type ModelResultSpec = {
  renderSuccess: ModelResultRenderer
  renderError?: ModelResultRenderer
}

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
  partnerId: string
  taskId: string
  workspaceRootPath: string
  emitActivity: (input: CapabilityActivityInput) => void
}

export type HumanToolSpec<
  TInput extends JsonObject = JsonObject,
  TName extends RuntimeToolName = RuntimeToolName,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = {
  name: TName
  familyId: AiToolFamilyId
  skillIds: TSkillId[]
  inputSchema: z.ZodType<TInput>
  promptSpec: ToolPromptSpec
  resolveExecutionMeta: ToolExecutionMetaResolver
  modelResult: ModelResultSpec
}

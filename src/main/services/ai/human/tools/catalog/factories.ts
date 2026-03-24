import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId, ToolPromptSpec } from '../../types'
import type {
  AiToolFamilyId,
  ToolContractDefinition,
  ToolExecutionMeta
} from '../types'

export type CapabilitySkillDefinition = {
  skillId: RuntimeSkillId
  title: string
  summary: string
  whenToUse: string
  detail: string
}

export type StaticExecutionMetaConfig = {
  mutability: ToolExecutionMeta['mutability']
  parallelSafe: boolean
  getResourceKey?: (args: JsonObject) => string | undefined
  defaultResourceKey?: string
}

export type CapabilityToolDefinition<
  TArgs extends JsonObject = JsonObject,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = ToolContractDefinition<TArgs, TName, TSkillId>

export const readStringArg = (args: JsonObject, key: string): string | undefined => {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const createStaticExecutionMetaResolver = (input: StaticExecutionMetaConfig) => {
  return (args: JsonObject): ToolExecutionMeta => ({
    mutability: input.mutability,
    parallelSafe: input.parallelSafe,
    resourceKey: input.getResourceKey?.(args) || input.defaultResourceKey
  })
}

export const createCapabilityToolDefinition = <
  TArgs extends JsonObject,
  TName extends string,
  TSkillId extends RuntimeSkillId
>(input: {
  name: TName
  familyId: AiToolFamilyId
  skillIds: TSkillId[]
  requiresWorkspace: boolean
  schema: z.ZodType<TArgs>
  promptSpec: ToolPromptSpec
  resolveExecutionMeta: (args: JsonObject) => ToolExecutionMeta
}): CapabilityToolDefinition<TArgs, TName, TSkillId> => ({
  name: input.name,
  familyId: input.familyId,
  skillIds: [...input.skillIds],
  requiresWorkspace: input.requiresWorkspace,
  schema: input.schema,
  promptSpec: input.promptSpec,
  resolveExecutionMeta: input.resolveExecutionMeta
})

export const createStaticCapabilityToolDefinition = <
  TArgs extends JsonObject,
  TName extends string,
  TSkillId extends RuntimeSkillId
>(input: {
  name: TName
  familyId: AiToolFamilyId
  skillIds: TSkillId[]
  requiresWorkspace: boolean
  schema: z.ZodType<TArgs>
  promptSpec: ToolPromptSpec
  executionMeta: StaticExecutionMetaConfig
}): CapabilityToolDefinition<TArgs, TName, TSkillId> =>
  createCapabilityToolDefinition({
    ...input,
    resolveExecutionMeta: createStaticExecutionMetaResolver(input.executionMeta)
  })

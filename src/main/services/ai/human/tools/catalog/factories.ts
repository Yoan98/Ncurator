import type { JsonObject } from '../../../../../../shared/types'
import type { RuntimeSkillId, ToolPromptSpec } from '../../types'
import type { AiToolFamilyId, ToolDescriptor, ToolExecutionMeta } from '../types'

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

export type CapabilityToolDefinition = ToolDescriptor

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

export const createCapabilityToolDefinition = (input: {
  name: string
  familyId: AiToolFamilyId
  skillIds: RuntimeSkillId[]
  requiresWorkspace: boolean
  promptSpec: ToolPromptSpec
  resolveExecutionMeta: (args: JsonObject) => ToolExecutionMeta
}): CapabilityToolDefinition => ({
  name: input.name,
  familyId: input.familyId,
  skillIds: [...input.skillIds],
  requiresWorkspace: input.requiresWorkspace,
  promptSpec: input.promptSpec,
  resolveExecutionMeta: input.resolveExecutionMeta
})

export const createStaticCapabilityToolDefinition = (input: {
  name: string
  familyId: AiToolFamilyId
  skillIds: RuntimeSkillId[]
  requiresWorkspace: boolean
  promptSpec: ToolPromptSpec
  executionMeta: StaticExecutionMetaConfig
}): CapabilityToolDefinition =>
  createCapabilityToolDefinition({
    ...input,
    resolveExecutionMeta: createStaticExecutionMetaResolver(input.executionMeta)
  })

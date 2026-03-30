import type { JsonObject } from '../../../../../../shared/types'
import type { ToolExecutionMeta, ToolExecutionMetaResolver } from '../types'

export type StaticExecutionMetaConfig = {
  mutability: ToolExecutionMeta['mutability']
  parallelSafe: boolean
  getResourceKey?: (args: JsonObject) => string | undefined
  defaultResourceKey?: string
}

export const readStringArg = (args: JsonObject, key: string): string | undefined => {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const createStaticExecutionMetaResolver = (
  input: StaticExecutionMetaConfig
): ToolExecutionMetaResolver => {
  return (args) => ({
    mutability: input.mutability,
    parallelSafe: input.parallelSafe,
    resourceKey: input.getResourceKey?.(args) || input.defaultResourceKey
  })
}

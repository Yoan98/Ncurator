import type { StructuredToolInterface } from '@langchain/core/tools'
import { toJSONSchema } from 'zod/v4'
import type { z } from 'zod/v4'

type ProviderToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const resolveProviderParameters = (
  schema: unknown
): Record<string, unknown> | undefined => {
  if (!schema) return undefined

  let document: unknown
  try {
    document = toJSONSchema(schema as z.ZodType)
  } catch {
    return undefined
  }
  if (!isJsonObject(document)) return undefined

  // zod/v4 对根级 z.discriminatedUnion 生成的 JSON Schema 根节点是 `{ oneOf: [...] }`，
  // 没有 `type: "object"`。DeepSeek 官方（及 OpenAI）要求每个工具 parameters 根必须是
  // object，否则整个请求 400。这里只在根缺失 type 时补上，语义不变（仍是"满足 oneOf 之一"）。
  if (document.type === 'object') return undefined
  return { ...document, type: 'object' }
}

export const attachProviderToolDefinitions = (tools: StructuredToolInterface[]): void => {
  for (const tool of tools) {
    const name = String(tool.name || '').trim()
    if (!name) continue

    const parameters = resolveProviderParameters(tool.schema)
    if (!parameters) continue

    const definition: ProviderToolDefinition = {
      type: 'function',
      function: {
        name,
        description: String(tool.description || ''),
        parameters
      }
    }
    const currentExtras = isJsonObject(tool.extras) ? tool.extras : {}
    tool.extras = { ...currentExtras, providerToolDefinition: definition }
  }
}

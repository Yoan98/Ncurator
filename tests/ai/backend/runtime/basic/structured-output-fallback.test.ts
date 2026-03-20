import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { invokeStructuredChat } from '../../../../../src/main/services/ai/structuredOutput'

const createChatModelMock = vi.fn()

vi.mock('../../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: (...args: unknown[]) => createChatModelMock(...args)
}))

const cfg = {
  id: 'cfg-1',
  name: 'test-model',
  base_url: 'https://example.com/v1',
  model_name: 'gpt-4o',
  api_key: 'test-key',
  is_active: true as const
}

const schema = z.object({
  mode: z.string()
})

describe('invokeStructuredChat', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('falls back from jsonSchema to functionCalling when provider does not support jsonSchema', async () => {
    const attemptedMethods: string[] = []

    createChatModelMock.mockImplementation(() => ({
      withStructuredOutput: (_schema: unknown, config: { method: string }) => ({
        invoke: async () => {
          attemptedMethods.push(config.method)
          if (config.method === 'jsonSchema') {
            throw new Error('Invalid parameter: response_format json_schema is not supported')
          }
          return { mode: 'function-calling-result' }
        }
      })
    }))

    const result = await invokeStructuredChat({
      caller: 'test.structured_output',
      cfg,
      schema,
      schemaName: 'test_schema',
      system: 'system prompt',
      user: 'user prompt'
    })

    expect(result).toEqual({ mode: 'function-calling-result' })
    expect(attemptedMethods).toEqual(['jsonSchema', 'functionCalling'])
  })

  it('falls back to jsonMode after jsonSchema and functionCalling are both unsupported', async () => {
    const attemptedMethods: string[] = []

    createChatModelMock.mockImplementation(() => ({
      withStructuredOutput: (_schema: unknown, config: { method: string }) => ({
        invoke: async () => {
          attemptedMethods.push(config.method)
          if (config.method === 'jsonSchema') {
            throw new Error('response_format json_schema not supported by this endpoint')
          }
          if (config.method === 'functionCalling') {
            throw new Error('tool_choice tools are not supported by this provider')
          }
          return { mode: 'json-mode-result' }
        }
      })
    }))

    const result = await invokeStructuredChat({
      caller: 'test.structured_output',
      cfg,
      schema,
      schemaName: 'test_schema',
      system: 'system prompt',
      user: 'user prompt'
    })

    expect(result).toEqual({ mode: 'json-mode-result' })
    expect(attemptedMethods).toEqual(['jsonSchema', 'functionCalling', 'jsonMode'])
  })

  it('does not fall back when the active method fails for a normal output error', async () => {
    const attemptedMethods: string[] = []

    createChatModelMock.mockImplementation(() => ({
      withStructuredOutput: (_schema: unknown, config: { method: string }) => ({
        invoke: async () => {
          attemptedMethods.push(config.method)
          throw new Error('Invalid output: expected string, received number')
        }
      })
    }))

    await expect(
      invokeStructuredChat({
        caller: 'test.structured_output',
        cfg,
        schema,
        schemaName: 'test_schema',
        system: 'system prompt',
        user: 'user prompt'
      })
    ).rejects.toThrow(/structured_output_failed/)

    expect(attemptedMethods).toEqual(['jsonSchema'])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock
}))

import { invokeStructuredChat } from '../../../../src/main/services/ai/llmExecutor'

const schema = z.object({
  answer: z.string()
})

const compatibleCfg = {
  id: 'cfg-1',
  name: 'Structured Output Config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key'
} as const

const baseInput = {
  caller: 'unit.test',
  schema,
  schemaName: 'unit_schema',
  system: 'Return JSON only.',
  user: 'Give me an answer.',
  temperature: 0.2
} as const

const configureCreateChatModel = (content: unknown, callOrder: string[]): void => {
  createChatModelMock.mockImplementation(() => ({
    invoke: async () => {
      callOrder.push('invoke')
      return {
        content
      }
    },
    stream: async () => {
      throw new Error('structured output should not stream in this test')
    },
    withConfig: () => {
      throw new Error('structured output should not call withConfig')
    }
  }))
}

describe('ai unit structured output single path', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('uses plain text completion without response_format', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(JSON.stringify({ answer: 'ok' }), callOrder)

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'ok' })
    expect(callOrder).toEqual(['invoke'])
    const modelOptions = createChatModelMock.mock.calls[0]?.[1] as
      | { streaming?: boolean; temperature?: number }
      | undefined
    expect(modelOptions?.streaming).toBe(false)
    expect(modelOptions?.temperature).toBe(0.2)
  })

  it('parses JSON wrapped in markdown code fences', async () => {
    configureCreateChatModel('```json\n{"answer":"from fences"}\n```', [])

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'from fences' })
  })

  it('repairs malformed JSON before schema validation', async () => {
    configureCreateChatModel('{"answer":"repaired",}', [])

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'repaired' })
  })

  it('rejects non-JSON output as an output error', async () => {
    configureCreateChatModel('not json at all', [])

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toMatchObject({
      name: 'LlmOutputError'
    })
  })

  it('rejects empty responses as an output error', async () => {
    configureCreateChatModel('', [])

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toMatchObject({
      name: 'LlmOutputError'
    })
  })

  it('rejects valid JSON that violates the schema', async () => {
    configureCreateChatModel(JSON.stringify({ answer: 123 }), [])

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toMatchObject({
      name: 'LlmOutputError'
    })
  })

  it('passes provider errors through for the retry layer', async () => {
    createChatModelMock.mockImplementation(() => ({
      invoke: async () => {
        throw Object.assign(new Error('Rate limit exceeded'), {
          status: 429,
          response: {
            status: 429,
            data: {
              error: {
                code: 'rate_limit_exceeded',
                message: 'Rate limit exceeded'
              }
            }
          }
        })
      },
      stream: async () => {
        throw new Error('unexpected stream')
      },
      withConfig: () => {
        throw new Error('unexpected withConfig')
      }
    }))

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toThrow(/Rate limit exceeded/u)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock
}))

import {
  STRUCTURED_OUTPUT_METHODS,
  STRUCTURED_OUTPUT_PROFILES,
} from '../../../src/main/services/ai/structuredOutput'
import { invokeStructuredChat } from '../../../src/main/services/ai/llmExecutor'

type StructuredOutputProfile =
  | 'completions:jsonSchema'
  | 'completions:jsonMode'
  | 'completions:promptJson'
  | 'responses:jsonSchema'
  | 'responses:promptJson'

type MethodBehavior =
  | {
      type: 'success'
      output: Record<string, unknown>
    }
  | {
      type: 'error'
      error: Error
    }

type MethodBehaviorMap = Partial<Record<StructuredOutputProfile, MethodBehavior>>

const schema = z.object({
  answer: z.string()
})

const cfg = {
  id: 'cfg-1',
  name: 'Primary',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key',
  is_active: true
} as const

const baseInput = {
  caller: 'unit.test',
  cfg,
  schema,
  schemaName: 'unit_schema',
  system: 'Return JSON only.',
  user: 'Give me an answer.',
  temperature: 0.2
} as const

const configureCreateChatModel = (behaviors: MethodBehaviorMap, callOrder: string[]): void => {
  createChatModelMock.mockImplementation(
    (_cfg, options?: { transport?: 'completions' | 'responses' }) => {
      const transport = options?.transport ?? 'completions'

      return {
        withConfig: (config: {
          response_format?: {
            type?: 'json_object' | 'json_schema'
          }
        }) => ({
          invoke: async () => {
            const method =
              config.response_format?.type === 'json_object' ? 'jsonMode' : 'jsonSchema'
            const profile = `${transport}:${method}` as StructuredOutputProfile
            callOrder.push(profile)
            const behavior = behaviors[profile]
            if (!behavior) throw new Error(`missing_behavior:${profile}`)
            if (behavior.type === 'error') throw behavior.error
            return {
              content: JSON.stringify(behavior.output)
            }
          }
        }),
        invoke: async () => {
          const profile = `${transport}:promptJson` as StructuredOutputProfile
          callOrder.push(profile)
          const behavior = behaviors[profile]
          if (!behavior) throw new Error(`missing_behavior:${profile}`)
          if (behavior.type === 'error') throw behavior.error
          return {
            content: JSON.stringify(behavior.output)
          }
        }
      }
    }
  )
}

describe('ai unit structured output auto fallback', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('uses completions jsonSchema first and stops when it succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'success',
          output: { answer: 'from schema' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(STRUCTURED_OUTPUT_METHODS).toEqual(['jsonSchema', 'jsonMode', 'promptJson'])
    expect(STRUCTURED_OUTPUT_PROFILES).toEqual([
      'completions:jsonSchema',
      'completions:jsonMode',
      'completions:promptJson',
      'responses:jsonSchema',
      'responses:promptJson'
    ])
    expect(result.output).toEqual({ answer: 'from schema' })
    expect(result.transport).toBe('completions')
    expect(result.method).toBe('jsonSchema')
    expect(result.profile).toBe('completions:jsonSchema')
    expect(result.fallbackChain).toEqual(['completions:jsonSchema'])
    expect(callOrder).toEqual(['completions:jsonSchema'])
  })

  it('falls back within completions when jsonSchema is unsupported and jsonMode succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'completions:jsonMode': {
          type: 'success',
          output: { answer: 'from json mode' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(result.output).toEqual({ answer: 'from json mode' })
    expect(result.transport).toBe('completions')
    expect(result.method).toBe('jsonMode')
    expect(result.profile).toBe('completions:jsonMode')
    expect(result.fallbackChain).toEqual(['completions:jsonSchema', 'completions:jsonMode'])
    expect(callOrder).toEqual(['completions:jsonSchema', 'completions:jsonMode'])
  })

  it('falls back when response_format is unavailable and promptJson succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'error',
          error: Object.assign(new Error('This response_format type is unavailable now'), {
            status: 400,
            response: {
              status: 400,
              data: {
                error: {
                  param: 'response_format',
                  message: 'This response_format type is unavailable now'
                }
              }
            }
          })
        },
        'completions:jsonMode': {
          type: 'error',
          error: new Error('response_format json_object is not supported by this provider')
        },
        'completions:promptJson': {
          type: 'success',
          output: { answer: 'from completions prompt json' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(result.output).toEqual({ answer: 'from completions prompt json' })
    expect(result.transport).toBe('completions')
    expect(result.method).toBe('promptJson')
    expect(result.profile).toBe('completions:promptJson')
    expect(result.fallbackChain).toEqual([
      'completions:jsonSchema',
      'completions:jsonMode',
      'completions:promptJson'
    ])
    expect(callOrder).toEqual([
      'completions:jsonSchema',
      'completions:jsonMode',
      'completions:promptJson'
    ])
  })

  it('jumps to responses when completions transport hits a compatibility error', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'message')")
        },
        'responses:jsonSchema': {
          type: 'success',
          output: { answer: 'from responses schema' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(result.output).toEqual({ answer: 'from responses schema' })
    expect(result.transport).toBe('responses')
    expect(result.method).toBe('jsonSchema')
    expect(result.profile).toBe('responses:jsonSchema')
    expect(result.fallbackChain).toEqual(['completions:jsonSchema', 'responses:jsonSchema'])
    expect(callOrder).toEqual(['completions:jsonSchema', 'responses:jsonSchema'])
  })

  it('falls back to responses promptJson via plain invoke and does not use raw fetch', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'completions:jsonMode': {
          type: 'error',
          error: new Error('response_format json_object is not supported by this provider')
        },
        'completions:promptJson': {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'message')")
        },
        'responses:jsonSchema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'responses:promptJson': {
          type: 'success',
          output: { answer: 'from responses prompt json' }
        }
      },
      callOrder
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      const result = await invokeStructuredChat(baseInput)

      expect(result.output).toEqual({ answer: 'from responses prompt json' })
      expect(result.transport).toBe('responses')
      expect(result.method).toBe('promptJson')
      expect(result.profile).toBe('responses:promptJson')
      expect(result.fallbackChain).toEqual([
        'completions:jsonSchema',
        'completions:jsonMode',
        'completions:promptJson',
        'responses:jsonSchema',
        'responses:promptJson'
      ])
      expect(callOrder).toEqual([
        'completions:jsonSchema',
        'completions:jsonMode',
        'completions:promptJson',
        'responses:jsonSchema',
        'responses:promptJson'
      ])
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('tries the preferred profile first and skips auto when it succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'responses:promptJson': {
          type: 'success',
          output: { answer: 'cached prompt json' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      preferredProfile: 'responses:promptJson'
    })

    expect(result.output).toEqual({ answer: 'cached prompt json' })
    expect(result.transport).toBe('responses')
    expect(result.method).toBe('promptJson')
    expect(result.profile).toBe('responses:promptJson')
    expect(result.fallbackChain).toEqual(['responses:promptJson'])
    expect(callOrder).toEqual(['responses:promptJson'])
  })

  it('falls back after a preferred-profile compatibility failure and returns the new winning profile', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'responses:jsonSchema': {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'message')")
        },
        'completions:jsonSchema': {
          type: 'success',
          output: { answer: 're-probed schema' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      preferredProfile: 'responses:jsonSchema'
    })

    expect(result.output).toEqual({ answer: 're-probed schema' })
    expect(result.transport).toBe('completions')
    expect(result.method).toBe('jsonSchema')
    expect(result.profile).toBe('completions:jsonSchema')
    expect(result.fallbackChain).toEqual(['responses:jsonSchema', 'completions:jsonSchema'])
    expect(callOrder).toEqual(['responses:jsonSchema', 'completions:jsonSchema'])
  })

  it('does not swallow non-compatibility errors from the preferred profile', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonMode': {
          type: 'error',
          error: new Error('network socket disconnected unexpectedly')
        }
      },
      callOrder
    )

    await expect(
      invokeStructuredChat({
        ...baseInput,
        preferredProfile: 'completions:jsonMode'
      })
    ).rejects.toThrow(
      'structured_output_failed; caller=unit.test; schema=unit_schema; model=gpt-5; profile=completions:jsonMode; transport=completions; method=jsonMode; reason=network socket disconnected unexpectedly'
    )
    expect(callOrder).toEqual(['completions:jsonMode'])
  })

  it('does not downgrade retryable errors into profile fallback', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions:jsonSchema': {
          type: 'error',
          error: Object.assign(new Error('Rate limit exceeded'), {
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
        }
      },
      callOrder
    )

    await expect(invokeStructuredChat(baseInput)).rejects.toThrow(
      'structured_output_retryable; caller=unit.test; schema=unit_schema; model=gpt-5; profile=completions:jsonSchema; transport=completions; method=jsonSchema; reason=Rate limit exceeded'
    )
    expect(callOrder).toEqual(['completions:jsonSchema'])
  })
})

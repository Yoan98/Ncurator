import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock,
  getSupportedTransportsForConfig: (cfg: { providerKind?: string }) =>
    cfg.providerKind === 'openai' ? ['responses', 'completions'] : ['completions']
}))

import {
  STRUCTURED_OUTPUT_METHODS,
  buildStructuredOutputStrategyAttemptOrder
} from '../../../../src/main/services/ai/structuredOutput'
import { invokeStructuredChat } from '../../../../src/main/services/ai/llmExecutor'
import type { StructuredOutputStrategy } from '../../../../src/shared/types'

type StrategyKey =
  | 'responses/json_schema'
  | 'responses/prompt_json'
  | 'completions/json_schema'
  | 'completions/json_object'
  | 'completions/prompt_json'

type MethodBehavior =
  | {
      type: 'success'
      rawText: string
    }
  | {
      type: 'error'
      error: Error
    }

type MethodBehaviorMap = Partial<Record<StrategyKey, MethodBehavior>>

const schema = z.object({
  answer: z.string()
})

const openAiCfg = {
  id: 'cfg-1',
  name: 'Structured Output Config',
  providerKind: 'openai',
  base_url: 'https://api.openai.com/v1',
  model_name: 'gpt-5',
  api_key: 'test-key'
} as const

const compatibleCfg = {
  ...openAiCfg,
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1'
} as const

const nvidiaCfg = {
  ...compatibleCfg,
  base_url: 'https://integrate.api.nvidia.com/v1'
} as const

const baseInput = {
  caller: 'unit.test',
  schema,
  schemaName: 'unit_schema',
  system: 'Return JSON only.',
  user: 'Give me an answer.',
  temperature: 0.2
} as const

const strategyKey = (strategy: StructuredOutputStrategy): StrategyKey =>
  `${strategy.transport}/${strategy.mode}` as StrategyKey

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
            const mode =
              config.response_format?.type === 'json_object' ? 'json_object' : 'json_schema'
            const key = `${transport}/${mode}` as StrategyKey
            callOrder.push(key)
            const behavior = behaviors[key]
            if (!behavior) throw new Error(`missing_behavior:${key}`)
            if (behavior.type === 'error') throw behavior.error
            return {
              content: behavior.rawText
            }
          }
        }),
        invoke: async () => {
          const key = `${transport}/prompt_json` as StrategyKey
          callOrder.push(key)
          const behavior = behaviors[key]
          if (!behavior) throw new Error(`missing_behavior:${key}`)
          if (behavior.type === 'error') throw behavior.error
          return {
            content: behavior.rawText
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

  it('generates strategy order dynamically and filters invalid protocol combos', () => {
    expect(STRUCTURED_OUTPUT_METHODS).toEqual(['jsonSchema', 'jsonMode', 'promptJson'])
    expect(
      buildStructuredOutputStrategyAttemptOrder({
        supportedTransports: ['responses', 'completions']
      }).map(strategyKey)
    ).toEqual([
      'responses/json_schema',
      'responses/prompt_json',
      'completions/json_schema',
      'completions/json_object',
      'completions/prompt_json'
    ])
  })

  it('puts a valid preferred strategy first and dedupes the rest', () => {
    expect(
      buildStructuredOutputStrategyAttemptOrder({
        supportedTransports: ['responses', 'completions'],
        preferredStrategy: {
          transport: 'completions',
          mode: 'json_object'
        }
      }).map(strategyKey)
    ).toEqual([
      'completions/json_object',
      'responses/json_schema',
      'responses/prompt_json',
      'completions/json_schema',
      'completions/prompt_json'
    ])
  })

  it('uses the first dynamic strategy and records the winning strategy', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'responses/json_schema': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'from schema' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: openAiCfg
    })

    expect(result.output).toEqual({ answer: 'from schema' })
    expect(result.strategy).toEqual({ transport: 'responses', mode: 'json_schema' })
    expect(result.fallbackStrategies).toEqual([{ transport: 'responses', mode: 'json_schema' }])
    expect(callOrder).toEqual(['responses/json_schema'])
  })

  it('uses the generic fallback order for NVIDIA NIM instead of a provider override', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'error',
          error: new SyntaxError('Unexpected token W in JSON')
        },
        'completions/json_object': {
          type: 'error',
          error: new SyntaxError('Unexpected token R in JSON')
        },
        'completions/prompt_json': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'from prompt json' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: nvidiaCfg
    })

    expect(result.output).toEqual({ answer: 'from prompt json' })
    expect(result.strategy).toEqual({ transport: 'completions', mode: 'prompt_json' })
    expect(callOrder).toEqual([
      'completions/json_schema',
      'completions/json_object',
      'completions/prompt_json'
    ])
  })

  it('falls back from unsupported json_schema to json_object for compatible providers', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'completions/json_object': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'from json object' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'from json object' })
    expect(result.strategy).toEqual({ transport: 'completions', mode: 'json_object' })
    expect(result.fallbackStrategies).toEqual([
      { transport: 'completions', mode: 'json_schema' },
      { transport: 'completions', mode: 'json_object' }
    ])
    expect(callOrder).toEqual(['completions/json_schema', 'completions/json_object'])
  })

  it('repairs malformed JSON before schema validation', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'completions/json_object': {
          type: 'success',
          rawText: '{"answer":"repaired",}'
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'repaired' })
    expect(result.strategy).toEqual({ transport: 'completions', mode: 'json_object' })
  })

  it('continues to prompt_json when repair fails', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'error',
          error: new Error('response_format json schema is not supported by this provider')
        },
        'completions/json_object': {
          type: 'success',
          rawText: 'not json at all'
        },
        'completions/prompt_json': {
          type: 'success',
          rawText: '```json\n{"answer":"from prompt"}\n```'
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'from prompt' })
    expect(result.strategy).toEqual({ transport: 'completions', mode: 'prompt_json' })
    expect(callOrder).toEqual([
      'completions/json_schema',
      'completions/json_object',
      'completions/prompt_json'
    ])
  })

  it('continues to the next strategy when JSON is valid but violates the schema', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'success',
          rawText: JSON.stringify({ answer: 123 })
        },
        'completions/json_object': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'schema-valid fallback' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: compatibleCfg
    })

    expect(result.output).toEqual({ answer: 'schema-valid fallback' })
    expect(callOrder).toEqual(['completions/json_schema', 'completions/json_object'])
  })

  it('tries the preferred strategy first', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'responses/prompt_json': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'cached prompt json' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: openAiCfg,
      preferredStrategy: {
        transport: 'responses',
        mode: 'prompt_json'
      }
    })

    expect(result.output).toEqual({ answer: 'cached prompt json' })
    expect(result.strategy).toEqual({ transport: 'responses', mode: 'prompt_json' })
    expect(callOrder).toEqual(['responses/prompt_json'])
  })

  it('does not downgrade retryable errors into strategy fallback', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
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

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderError',
      message: 'Rate limit exceeded',
      httpStatus: 429,
      providerCode: 'rate_limit_exceeded',
      retryable: true
    })
    expect(callOrder).toEqual(['completions/json_schema'])
  })

  it('tries another structured strategy after provider capacity exhaustion', async () => {
    const callOrder: string[] = []
    const capacityError = Object.assign(
      new Error('ResourceExhausted: Worker local total request limit reached (48/48)'),
      { status: 503 }
    )
    configureCreateChatModel(
      {
        'completions/json_schema': { type: 'error', error: capacityError },
        'completions/json_object': { type: 'error', error: capacityError },
        'completions/prompt_json': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'capacity fallback worked' })
        }
      },
      callOrder
    )

    const firstResult = await invokeStructuredChat({
      ...baseInput,
      cfg: nvidiaCfg
    })

    expect(firstResult.output).toEqual({ answer: 'capacity fallback worked' })
    expect(firstResult.strategy).toEqual({ transport: 'completions', mode: 'prompt_json' })
    expect(callOrder).toEqual([
      'completions/json_schema',
      'completions/json_object',
      'completions/prompt_json'
    ])

    callOrder.length = 0
    const secondResult = await invokeStructuredChat({
      ...baseInput,
      cfg: {
        ...nvidiaCfg,
        preferredTransport: 'completions',
        preferredStructuredOutputMode: 'prompt_json'
      }
    })

    expect(secondResult.output).toEqual({ answer: 'capacity fallback worked' })
    expect(callOrder).toEqual(['completions/prompt_json'])
  })

  it('surfaces non-retryable provider failures without trying another strategy', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/json_schema': {
          type: 'error',
          error: Object.assign(new Error('The selected model is not activated'), {
            response: {
              status: 404,
              data: {
                error: {
                  code: 'ModelNotOpen',
                  type: 'Not Found',
                  message: 'The selected model is not activated'
                }
              }
            }
          })
        }
      },
      callOrder
    )

    await expect(
      invokeStructuredChat({
        ...baseInput,
        cfg: compatibleCfg
      })
    ).rejects.toMatchObject({
      name: 'LlmProviderError',
      message: 'The selected model is not activated',
      httpStatus: 404,
      providerCode: 'ModelNotOpen',
      retryable: false
    })
    expect(callOrder).toEqual(['completions/json_schema'])
  })

  it('uses prompt_json directly when model capabilities disable native structured output', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        'completions/prompt_json': {
          type: 'success',
          rawText: JSON.stringify({ answer: 'capability-directed prompt json' })
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      cfg: {
        ...compatibleCfg,
        supportedStructuredOutputModes: ['prompt_json']
      }
    })

    expect(result.output).toEqual({ answer: 'capability-directed prompt json' })
    expect(callOrder).toEqual(['completions/prompt_json'])
  })
})

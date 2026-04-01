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
  invokeStructuredChat
} from '../../../src/main/services/ai/structuredOutput'

type MethodBehavior =
  | {
      type: 'success'
      output: Record<string, unknown>
    }
  | {
      type: 'error'
      error: Error
    }

type MethodBehaviorMap = {
  jsonSchema?: MethodBehavior
  jsonMode?: MethodBehavior
  promptJson?: MethodBehavior
}

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
  createChatModelMock.mockImplementation(() => ({
    withStructuredOutput: (_schema: typeof schema, config: { method: 'jsonSchema' | 'jsonMode' }) => ({
      invoke: async () => {
        callOrder.push(config.method)
        const behavior = behaviors[config.method]
        if (!behavior) throw new Error(`missing_behavior:${config.method}`)
        if (behavior.type === 'error') throw behavior.error
        return behavior.output
      }
    }),
    invoke: async () => {
      callOrder.push('promptJson')
      const behavior = behaviors.promptJson
      if (!behavior) throw new Error('missing_behavior:promptJson')
      if (behavior.type === 'error') throw behavior.error
      return {
        content: JSON.stringify(behavior.output)
      }
    }
  }))
}

describe('ai unit structured output auto fallback', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('uses jsonSchema first and stops when it succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        jsonSchema: {
          type: 'success',
          output: { answer: 'from schema' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(STRUCTURED_OUTPUT_METHODS).toEqual(['jsonSchema', 'jsonMode', 'promptJson'])
    expect(result.output).toEqual({ answer: 'from schema' })
    expect(result.method).toBe('jsonSchema')
    expect(result.fallbackChain).toEqual(['jsonSchema'])
    expect(callOrder).toEqual(['jsonSchema'])
  })

  it('falls back from jsonSchema to jsonMode when provider compatibility fails', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        jsonSchema: {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'map')")
        },
        jsonMode: {
          type: 'success',
          output: { answer: 'from json mode' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat(baseInput)

    expect(result.output).toEqual({ answer: 'from json mode' })
    expect(result.method).toBe('jsonMode')
    expect(result.fallbackChain).toEqual(['jsonSchema', 'jsonMode'])
    expect(callOrder).toEqual(['jsonSchema', 'jsonMode'])
  })

  it('falls back to promptJson via plain invoke and does not use raw fetch', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        jsonSchema: {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'map')")
        },
        jsonMode: {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'message')")
        },
        promptJson: {
          type: 'success',
          output: { answer: 'from prompt json' }
        }
      },
      callOrder
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      const result = await invokeStructuredChat(baseInput)

      expect(result.output).toEqual({ answer: 'from prompt json' })
      expect(result.method).toBe('promptJson')
      expect(result.fallbackChain).toEqual(['jsonSchema', 'jsonMode', 'promptJson'])
      expect(callOrder).toEqual(['jsonSchema', 'jsonMode', 'promptJson'])
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('tries the preferred method first and skips auto when it succeeds', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        promptJson: {
          type: 'success',
          output: { answer: 'cached prompt json' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      preferredMethod: 'promptJson'
    })

    expect(result.output).toEqual({ answer: 'cached prompt json' })
    expect(result.method).toBe('promptJson')
    expect(result.fallbackChain).toEqual(['promptJson'])
    expect(callOrder).toEqual(['promptJson'])
  })

  it('falls back after a preferred-method compatibility failure and returns the new winning method', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        jsonMode: {
          type: 'error',
          error: new Error("Cannot read properties of undefined (reading 'message')")
        },
        jsonSchema: {
          type: 'success',
          output: { answer: 're-probed schema' }
        }
      },
      callOrder
    )

    const result = await invokeStructuredChat({
      ...baseInput,
      preferredMethod: 'jsonMode'
    })

    expect(result.output).toEqual({ answer: 're-probed schema' })
    expect(result.method).toBe('jsonSchema')
    expect(result.fallbackChain).toEqual(['jsonMode', 'jsonSchema'])
    expect(callOrder).toEqual(['jsonMode', 'jsonSchema'])
  })

  it('does not swallow non-compatibility errors from the preferred method', async () => {
    const callOrder: string[] = []
    configureCreateChatModel(
      {
        jsonMode: {
          type: 'error',
          error: new Error('network socket disconnected unexpectedly')
        }
      },
      callOrder
    )

    await expect(
      invokeStructuredChat({
        ...baseInput,
        preferredMethod: 'jsonMode'
      })
    ).rejects.toThrow(
      'structured_output_failed; caller=unit.test; schema=unit_schema; model=gpt-5; method=jsonMode; reason=network socket disconnected unexpectedly'
    )
    expect(callOrder).toEqual(['jsonMode'])
  })
})

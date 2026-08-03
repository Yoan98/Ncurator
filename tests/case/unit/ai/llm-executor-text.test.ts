import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock,
  getSupportedTransportsForConfig: (cfg: { providerKind?: string }) =>
    cfg.providerKind === 'openai-compatible' ? ['completions'] : ['responses', 'completions']
}))

import { createAiLlmExecutor } from '../../../../src/main/services/ai/llmExecutor'
import type { AiLlmDriver } from '../../../../src/main/services/ai/llmExecutor'
import { LlmProviderError } from '../../../../src/main/services/ai/errors'
import type { AiLlmIoRecord, AiRunEvent, LlmRuntimeConfig } from '../../../../src/shared/types'

const baseConfig: LlmRuntimeConfig = {
  id: 'cfg-1',
  name: 'Unit Config',
  providerKind: 'openai',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key'
}

describe('ai unit llm executor text path', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('falls back from completions to responses and persists the resolved text transport', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const saveConfig = vi.fn(async () => undefined)

    createChatModelMock.mockImplementation(
      (cfg: LlmRuntimeConfig, options?: { transport?: 'completions' | 'responses' }) => {
        void cfg
        const transport = options?.transport ?? 'responses'
        return {
          invoke: async () => {
            if (transport === 'completions') {
              throw new Error("Cannot read properties of undefined (reading 'message')")
            }

            return {
              content: 'Hello from responses'
            }
          },
          stream: async () => ({
            async *[Symbol.asyncIterator]() {
              yield {
                content: 'unexpected'
              }
            }
          }),
          withConfig: () => {
            throw new Error('text output should not call withConfig')
          }
        }
      }
    )

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-1',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runtimeSettings: {
        llmStreamingMode: 'force_non_stream'
      },
      getConfig: async () => ({
        ...baseConfig,
        preferredTransport: 'completions'
      }),
      saveConfig,
      checkCancelled: () => undefined
    })

    const result = await executor.chatText({
      caller: 'human.mouth',
      taskId: 'task-1',
      schemaName: 'human_mouth_markdown',
      system: 'system prompt',
      user: 'user prompt'
    })

    expect(result).toBe('Hello from responses')
    expect(
      createChatModelMock.mock.calls.map(
        (call) => (call[1] as { transport?: 'completions' | 'responses' } | undefined)?.transport
      )
    ).toEqual(['completions', 'responses'])
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(saveConfig.mock.calls[0]?.[0]).toMatchObject({
      preferredTransport: 'responses'
    })
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.actionType === 'llm_text_output' &&
          event.status === 'completed'
      )
    ).toBe(true)
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.mouth',
      transport: 'responses',
      streamingMode: 'force_non_stream',
      streamed: false,
      rawText: 'Hello from responses'
    })
  })

  it('persists the winning structured fallback strategy for the next run', async () => {
    let currentConfig = baseConfig
    const preferredStrategies: Array<unknown> = []
    const saveConfig = vi.fn(async (nextConfig: LlmRuntimeConfig) => {
      currentConfig = nextConfig
    })
    const driver: AiLlmDriver = {
      chatStructured: async (input) => {
        preferredStrategies.push(input.preferredStrategy)
        return {
          output: { answer: 'from prompt json' },
          rawText: '{"answer":"from prompt json"}',
          method: 'promptJson',
          transport: 'completions',
          structuredOutputMode: 'prompt_json',
          strategy: { transport: 'completions', mode: 'prompt_json' }
        }
      }
    }

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-structured-persist',
        sendEvent: () => undefined
      },
      runtimeSettings: { llmStreamingMode: 'force_non_stream' },
      getConfig: async () => currentConfig,
      saveConfig,
      checkCancelled: () => undefined,
      driver
    })

    const request = {
      caller: 'human.brain',
      schemaName: 'unit_schema',
      schema: z.object({ answer: z.string() }),
      system: 'Return JSON only.',
      user: 'Say hello.'
    } as const
    const firstResult = await executor.chatStructured(request)
    const secondResult = await executor.chatStructured(request)

    expect(firstResult.output).toEqual({ answer: 'from prompt json' })
    expect(secondResult.output).toEqual({ answer: 'from prompt json' })
    expect(preferredStrategies).toEqual([
      undefined,
      { transport: 'completions', mode: 'prompt_json' }
    ])
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredTransport: 'completions',
        preferredStructuredOutputMode: 'prompt_json'
      })
    )
  })

  it('replaces a failed preferred strategy and reuses the winner within and across runs', async () => {
    let currentConfig: LlmRuntimeConfig = {
      ...baseConfig,
      providerKind: 'openai-compatible',
      preferredTransport: 'completions',
      preferredStructuredOutputMode: 'prompt_json'
    }
    const strategyCalls: string[] = []
    const saveConfig = vi.fn(async (nextConfig: LlmRuntimeConfig) => {
      currentConfig = nextConfig
    })

    createChatModelMock.mockImplementation(
      (_cfg: LlmRuntimeConfig, options?: { transport?: 'responses' | 'completions' }) => {
        const transport = options?.transport || 'completions'
        return {
          withConfig: (config: { response_format?: { type?: 'json_object' | 'json_schema' } }) => ({
            invoke: async () => {
              const mode =
                config.response_format?.type === 'json_object' ? 'json_object' : 'json_schema'
              strategyCalls.push(`${transport}/${mode}`)
              if (mode === 'json_schema') {
                throw new Error('response_format json schema is not supported by this provider')
              }
              return { content: JSON.stringify({ answer: 'from json object' }) }
            }
          }),
          invoke: async () => {
            strategyCalls.push(`${transport}/prompt_json`)
            return { content: 'not json' }
          },
          stream: async () => ({
            async *[Symbol.asyncIterator]() {
              yield { content: 'unexpected' }
            }
          })
        }
      }
    )

    const createExecutor = (runId: string) =>
      createAiLlmExecutor({
        eventCtx: { runId, sendEvent: () => undefined },
        runtimeSettings: { llmStreamingMode: 'force_non_stream' },
        getConfig: async () => currentConfig,
        saveConfig,
        checkCancelled: () => undefined
      })

    const request = {
      caller: 'human.brain',
      schemaName: 'unit_schema',
      schema: z.object({ answer: z.string() }),
      system: 'Return JSON only.',
      user: 'Say hello.'
    } as const

    const firstExecutor = createExecutor('run-preferred-replacement-1')
    const firstResult = await firstExecutor.chatStructured(request)
    const secondResult = await firstExecutor.chatStructured(request)
    const secondRunExecutor = createExecutor('run-preferred-replacement-2')
    const thirdResult = await secondRunExecutor.chatStructured(request)

    expect(firstResult.output).toEqual({ answer: 'from json object' })
    expect(secondResult.output).toEqual({ answer: 'from json object' })
    expect(thirdResult.output).toEqual({ answer: 'from json object' })
    expect(strategyCalls).toEqual([
      'completions/prompt_json',
      'completions/json_schema',
      'completions/json_object',
      'completions/json_object',
      'completions/json_object'
    ])
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(currentConfig).toMatchObject({
      preferredTransport: 'completions',
      preferredStructuredOutputMode: 'json_object'
    })
  })

  it('does not replace the preferred strategy when every strategy fails', async () => {
    const originalConfig: LlmRuntimeConfig = {
      ...baseConfig,
      providerKind: 'openai-compatible',
      preferredTransport: 'completions',
      preferredStructuredOutputMode: 'prompt_json'
    }
    const saveConfig = vi.fn(async () => undefined)
    const strategyCalls: string[] = []

    createChatModelMock.mockImplementation(
      (_cfg: LlmRuntimeConfig, options?: { transport?: 'responses' | 'completions' }) => {
        const transport = options?.transport || 'completions'
        return {
          withConfig: (config: { response_format?: { type?: 'json_object' | 'json_schema' } }) => ({
            invoke: async () => {
              const mode =
                config.response_format?.type === 'json_object' ? 'json_object' : 'json_schema'
              strategyCalls.push(`${transport}/${mode}`)
              throw new Error('response_format is unavailable')
            }
          }),
          invoke: async () => {
            strategyCalls.push(`${transport}/prompt_json`)
            return { content: 'not json' }
          },
          stream: async () => ({
            async *[Symbol.asyncIterator]() {
              yield { content: 'unexpected' }
            }
          })
        }
      }
    )

    const executor = createAiLlmExecutor({
      eventCtx: { runId: 'run-preferred-preserved', sendEvent: () => undefined },
      runtimeSettings: { llmStreamingMode: 'force_non_stream' },
      getConfig: async () => originalConfig,
      saveConfig,
      checkCancelled: () => undefined
    })

    await expect(
      executor.chatStructured({
        caller: 'human.brain',
        schemaName: 'unit_schema',
        schema: z.object({ answer: z.string() }),
        system: 'Return JSON only.',
        user: 'Say hello.'
      })
    ).rejects.toThrow('模型返回内容无法解析为要求的结构')

    expect(strategyCalls).toEqual([
      'completions/prompt_json',
      'completions/json_schema',
      'completions/json_object'
    ])
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('recovers when ResourceExhausted fails twice and the third attempt succeeds', async () => {
    vi.useFakeTimers()
    try {
      const events: AiRunEvent[] = []
      const saveConfig = vi.fn(async () => undefined)
      let callCount = 0
      const driver: AiLlmDriver = {
        chatStructured: async () => {
          callCount += 1
          if (callCount < 3) {
            throw new LlmProviderError({
              message: '503 ResourceExhausted: Worker local total request limit reached (48/48)',
              httpStatus: 503,
              providerCode: 'service_unavailable',
              retryable: true
            })
          }
          return {
            output: { answer: 'recovered on attempt 3' },
            rawText: '{"answer":"recovered on attempt 3"}',
            method: 'promptJson',
            transport: 'completions',
            structuredOutputMode: 'prompt_json',
            strategy: { transport: 'completions', mode: 'prompt_json' }
          }
        }
      }

      const executor = createAiLlmExecutor({
        eventCtx: {
          runId: 'run-resource-exhausted-recovery',
          sendEvent: (event) => events.push(event)
        },
        runtimeSettings: { llmStreamingMode: 'force_non_stream' },
        getConfig: async () => baseConfig,
        saveConfig,
        checkCancelled: () => undefined,
        driver
      })

      const resultPromise = executor.chatStructured({
        caller: 'human.brain',
        schemaName: 'unit_schema',
        schema: z.object({ answer: z.string() }),
        system: 'Return JSON only.',
        user: 'List files.'
      })

      await vi.advanceTimersByTimeAsync(2_000)
      await vi.advanceTimersByTimeAsync(4_000)
      const result = await resultPromise

      const retryStarted = events.filter(
        (event) =>
          event.type === 'assistant_process_group_started' && event.display.kind === 'retry'
      )
      expect(result.output).toEqual({ answer: 'recovered on attempt 3' })
      expect(callCount).toBe(3)
      expect(retryStarted.map((event) => event.display)).toEqual([
        expect.objectContaining({ kind: 'retry', attempt: 2, maxAttempts: 5 }),
        expect.objectContaining({ kind: 'retry', attempt: 3, maxAttempts: 5 })
      ])
      expect(
        events.some((event) => event.type === 'assistant_process_group_completed')
      ).toBe(true)
      expect(
        events.some((event) => event.type === 'assistant_process_group_failed')
      ).toBe(false)
      expect(saveConfig).toHaveBeenCalledTimes(1)
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredTransport: 'completions',
          preferredStructuredOutputMode: 'prompt_json'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards streamed text deltas through the observer and records stream metadata', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const saveConfig = vi.fn(async () => undefined)
    const answerChunks: string[] = []

    const driver: AiLlmDriver = {
      chatText: async (input) => {
        input.observer?.onDelta?.('Hello')
        input.observer?.onDelta?.(' world')
        return {
          output: 'Hello world',
          rawText: 'Hello world',
          transport: 'responses',
          streamed: true
        }
      }
    }

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-2',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runtimeSettings: {
        llmStreamingMode: 'force_stream'
      },
      getConfig: async () => baseConfig,
      saveConfig,
      checkCancelled: () => undefined,
      driver
    })

    const result = await executor.chatText({
      caller: 'human.mouth',
      taskId: 'task-2',
      schemaName: 'human_mouth_markdown',
      system: 'system prompt',
      user: 'user prompt',
      onTextDelta: (text) => answerChunks.push(text)
    })

    expect(result).toBe('Hello world')
    expect(answerChunks).toEqual(['Hello', ' world'])

    const streamEvents = events.filter((event) => event.type === 'llm_stream_delta')
    expect(streamEvents).toHaveLength(2)
    expect(streamEvents[0]).toMatchObject({
      type: 'llm_stream_delta',
      runId: 'run-2',
      taskId: 'task-2',
      caller: 'human.mouth',
      chunkIndex: 1,
      text: 'Hello',
      internal: true
    })
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.mouth',
      transport: 'responses',
      streamingMode: 'force_stream',
      streamed: true,
      chunkCount: 2,
      rawText: 'Hello world',
      status: 'completed'
    })
    expect(saveConfig).toHaveBeenCalledTimes(1)
    expect(saveConfig.mock.calls[0]?.[0]).toMatchObject({
      preferredTransport: 'responses'
    })
  })

  it('fails early when a streamed response stalls on blank deltas', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const saveConfig = vi.fn(async () => undefined)

    createChatModelMock.mockImplementation(() => ({
      invoke: async () => ({
        content: 'unexpected'
      }),
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            content: '{"partial":'
          }
          for (let index = 0; index < 513; index += 1) {
            yield {
              content: ' \t   '
            }
          }
        }
      }),
      withConfig: () => {
        throw new Error('text output should not call withConfig')
      }
    }))

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-3',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runtimeSettings: {
        llmStreamingMode: 'force_stream'
      },
      getConfig: async () => ({
        ...baseConfig,
        preferredTransport: 'completions'
      }),
      saveConfig,
      checkCancelled: () => undefined
    })

    await expect(
      executor.chatText({
        caller: 'human.brain',
        taskId: 'task-3',
        schemaName: 'human_brain_decision',
        system: 'system prompt',
        user: 'user prompt'
      })
    ).rejects.toThrow('llm_stream_blank_delta_stall; blankChunks=513')

    const failedActivity = events
      .filter((event) => event.type === 'activity')
      .find((event) => event.type === 'activity' && event.status === 'failed')
    expect(failedActivity).toMatchObject({
      type: 'activity',
      actionType: 'llm_text_output',
      status: 'failed',
      details: {
        streamed: true,
        chunkCount: 513,
        reason: 'error'
      }
    })
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.brain',
      schemaName: 'human_brain_decision',
      streamingMode: 'force_stream',
      streamed: true,
      chunkCount: 513,
      status: 'failed',
      reason: expect.stringContaining('llm_stream_blank_delta_stall; blankChunks=513')
    })
  })

  it('preserves cancellation errors when external abort is triggered', async () => {
    const controller = new AbortController()
    const driver: AiLlmDriver = {
      chatText: async (input) =>
        await new Promise((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })),
            { once: true }
          )
        })
    }
    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-cancel',
        sendEvent: () => undefined
      },
      runtimeSettings: {
        llmStreamingMode: 'force_non_stream'
      },
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
      checkCancelled: () => undefined,
      abortSignal: controller.signal,
      driver
    })

    const pending = executor.chatText({
      caller: 'human.mouth',
      taskId: 'task-cancel',
      schemaName: 'human_mouth_markdown',
      system: 'system prompt',
      user: 'user prompt'
    })
    setTimeout(() => controller.abort(), 0)

    await expect(pending).rejects.toMatchObject({
      message: '已取消',
      code: 'CANCELLED'
    })
  })

  it('passes the fixed llm timeout into model creation', async () => {
    createChatModelMock.mockImplementation(() => ({
      invoke: async () => ({
        content: 'ok'
      }),
      stream: async () => ({
        async *[Symbol.asyncIterator]() {
          yield { content: 'ok' }
        }
      }),
      withConfig: () => {
        throw new Error('text output should not call withConfig')
      }
    }))

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-timeout-prop',
        sendEvent: () => undefined
      },
      runtimeSettings: {
        llmStreamingMode: 'force_non_stream'
      },
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
      checkCancelled: () => undefined
    })

    await executor.chatText({
      caller: 'human.mouth',
      taskId: 'task-timeout-prop',
      schemaName: 'human_mouth_markdown',
      system: 'system prompt',
      user: 'user prompt'
    })

    expect(createChatModelMock.mock.calls[0]?.[1]).toMatchObject({
      timeout: 480000
    })
  })
})

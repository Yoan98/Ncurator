import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { HumanMessage } from '@langchain/core/messages'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock
}))

import { createAiLlmExecutor } from '../../../../src/main/services/ai/llmExecutor'
import type { AiLlmDriver } from '../../../../src/main/services/ai/llmExecutor'
import { LlmProviderError } from '../../../../src/main/services/ai/errors'
import type { AiLlmIoRecord, AiRunEvent, LlmRuntimeConfig } from '../../../../src/shared/types'

const baseConfig: LlmRuntimeConfig = {
  id: 'cfg-1',
  name: 'Unit Config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key'
}

describe('ai unit llm executor text path', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('invokes the model once and returns the text output', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []

    createChatModelMock.mockImplementation(() => ({
      invoke: async () => ({
        content: 'Hello from the model'
      }),
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
    }))

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-1',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runtimeSettings: {
        llmStreamingMode: 'force_non_stream'
      },
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
      checkCancelled: () => undefined
    })

    const result = await executor.chatText({
      caller: 'human.mouth',
      taskId: 'task-1',
      schemaName: 'human_mouth_markdown',
      system: 'system prompt',
      user: 'user prompt'
    })

    expect(result).toBe('Hello from the model')
    expect(createChatModelMock).toHaveBeenCalledTimes(1)
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
      streamingMode: 'force_non_stream',
      streamed: false,
      rawText: 'Hello from the model',
      status: 'completed'
    })
  })

  it('forwards image blocks to the main model and preserves an unsupported-image error', async () => {
    const invoke = vi.fn(async (messages: HumanMessage[]) => {
      expect(JSON.stringify(messages[0]?.content)).toContain('data:image/png;base64,AA==')
      throw new LlmProviderError({
        message: 'image input is not supported by this model',
        httpStatus: 400,
        providerCode: 'unsupported_image',
        retryable: false
      })
    })
    createChatModelMock.mockImplementation(() => ({ invoke }))
    const executor = createAiLlmExecutor({
      eventCtx: { runId: 'run-image-unsupported', sendEvent: () => undefined },
      runtimeSettings: { llmStreamingMode: 'force_non_stream' },
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
      checkCancelled: () => undefined
    })

    await expect(
      executor.chatMessages({
        caller: 'human.brain',
        taskId: 'task-image-unsupported',
        schemaName: 'human_brain_messages',
        messages: [
          new HumanMessage({
            content: [
              { type: 'text', text: '读取图片' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }
            ]
          })
        ]
      })
    ).rejects.toMatchObject({
      message: 'image input is not supported by this model',
      httpStatus: 400,
      providerCode: 'unsupported_image'
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('includes image identity in context hashes without recording base64 payloads', async () => {
    const llmIoRecords: AiLlmIoRecord[] = []
    createChatModelMock.mockImplementation(() => ({
      invoke: async () => ({ content: 'ok' })
    }))
    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-image-hash',
        sendEvent: () => undefined,
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runtimeSettings: { llmStreamingMode: 'force_non_stream' },
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
      checkCancelled: () => undefined
    })
    for (const payload of ['AA==', 'AQ==']) {
      await executor.chatMessages({
        caller: 'human.brain',
        schemaName: 'human_brain_messages',
        messages: [
          new HumanMessage({
            content: [
              { type: 'text', text: '读取图片' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${payload}` } }
            ]
          })
        ]
      })
    }

    expect(llmIoRecords).toHaveLength(2)
    expect(llmIoRecords[0]?.dynamicContextHash).not.toBe(llmIoRecords[1]?.dynamicContextHash)
    expect(JSON.stringify(llmIoRecords)).not.toContain('data:image/png;base64,AA==')
    expect(JSON.stringify(llmIoRecords)).not.toContain('data:image/png;base64,AQ==')
  })

  it('forwards driver structured output and text output without persisting preferences', async () => {
    const saveConfig = vi.fn(async () => undefined)
    const driver: AiLlmDriver = {
      chatStructured: async () => ({
        output: { answer: 'from driver' },
        rawText: '{"answer":"from driver"}'
      }),
      chatText: async () => ({
        output: 'text from driver',
        rawText: 'text from driver'
      })
    }

    const executor = createAiLlmExecutor({
      eventCtx: {
        runId: 'run-driver',
        sendEvent: () => undefined
      },
      runtimeSettings: { llmStreamingMode: 'force_non_stream' },
      getConfig: async () => baseConfig,
      saveConfig,
      checkCancelled: () => undefined,
      driver
    })

    const structuredResult = await executor.chatStructured({
      caller: 'human.brain',
      schemaName: 'unit_schema',
      schema: z.object({ answer: z.string() }),
      system: 'Return JSON only.',
      user: 'Say hello.'
    })
    const textResult = await executor.chatText({
      caller: 'human.mouth',
      schemaName: 'unit_schema',
      system: 'system',
      user: 'user'
    })

    expect(structuredResult.output).toEqual({ answer: 'from driver' })
    expect(textResult).toBe('text from driver')
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('recovers when ResourceExhausted fails twice and the third attempt succeeds', async () => {
    vi.useFakeTimers()
    try {
      const events: AiRunEvent[] = []
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
            rawText: '{"answer":"recovered on attempt 3"}'
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
        saveConfig: async () => undefined,
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
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries schema-invalid structured output when retryOutputErrors is set', async () => {
    vi.useFakeTimers()
    try {
      let callCount = 0
      const driver: AiLlmDriver = {
        chatStructured: async () => {
          callCount += 1
          if (callCount < 3) {
            return {
              output: { wrong: true },
              rawText: '{"wrong":true}'
            }
          }
          return {
            output: { ok: true },
            rawText: '{"ok":true}'
          }
        }
      }

      const executor = createAiLlmExecutor({
        eventCtx: {
          runId: 'run-output-retry',
          sendEvent: () => undefined
        },
        runtimeSettings: { llmStreamingMode: 'force_non_stream' },
        getConfig: async () => baseConfig,
        saveConfig: async () => undefined,
        checkCancelled: () => undefined,
        driver
      })

      const resultPromise = executor.chatStructured({
        caller: 'human.brain',
        schemaName: 'human_brain',
        schema: z.object({ ok: z.boolean() }),
        system: 'Return JSON only.',
        user: 'Decide.',
        retryOutputErrors: true
      })

      await vi.advanceTimersByTimeAsync(500)
      await vi.advanceTimersByTimeAsync(750)
      const result = await resultPromise
      expect(result.output).toEqual({ ok: true })
      expect(callCount).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forwards streamed text deltas through the observer and records stream metadata', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const answerChunks: string[] = []

    const driver: AiLlmDriver = {
      chatText: async (input) => {
        input.observer?.onDelta?.('Hello')
        input.observer?.onDelta?.(' world')
        return {
          output: 'Hello world',
          rawText: 'Hello world',
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
      saveConfig: async () => undefined,
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
      streamingMode: 'force_stream',
      streamed: true,
      chunkCount: 2,
      rawText: 'Hello world',
      status: 'completed'
    })
  })

  it('fails early when a streamed response stalls on blank deltas', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []

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
      getConfig: async () => baseConfig,
      saveConfig: async () => undefined,
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
        reason: 'unexpected_error'
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
      timeout: 300000
    })
  })
})

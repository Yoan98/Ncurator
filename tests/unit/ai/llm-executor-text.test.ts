import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createChatModelMock } = vi.hoisted(() => ({
  createChatModelMock: vi.fn()
}))

vi.mock('../../../src/main/services/llm/chatModel', () => ({
  createChatModel: createChatModelMock,
  getSupportedTransportsForConfig: () => ['responses', 'completions']
}))

import { createAiLlmExecutor } from '../../../src/main/services/ai/llmExecutor'
import type { AiLlmDriver } from '../../../src/main/services/ai/llmExecutor'
import type { AiLlmIoRecord, AiRunEvent, LLMConfig } from '../../../src/shared/types'

const baseConfig: LLMConfig = {
  id: 'cfg-1',
  name: 'Primary',
  providerKind: 'openai',
  base_url: 'https://example.test/v1',
  model_name: 'gpt-5',
  api_key: 'test-key',
  is_active: true
}

describe('ai unit llm executor text path', () => {
  beforeEach(() => {
    createChatModelMock.mockReset()
  })

  it('falls back from completions to responses and persists the resolved text transport', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const saveConfig = vi.fn(async (_cfg: LLMConfig) => undefined)

    createChatModelMock.mockImplementation(
      (_cfg: LLMConfig, options?: { transport?: 'completions' | 'responses' }) => {
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

  it('forwards streamed text deltas through the observer and records stream metadata', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []
    const saveConfig = vi.fn(async (_cfg: LLMConfig) => undefined)
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
})

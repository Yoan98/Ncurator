import { AIMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import {
  createAiLlmExecutor,
  type AiLlmDriver
} from '../../../../src/main/services/ai/llmExecutor'
import type { LlmRuntimeConfig } from '../../../../src/shared/types'

const config: LlmRuntimeConfig = {
  id: 'config-1',
  name: 'config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  model_name: 'model',
  api_key: 'key'
}

const run = async (driver: AiLlmDriver) => {
  const executor = createAiLlmExecutor({
    eventCtx: { runId: 'run-1', sendEvent: () => undefined },
    runtimeSettings: { llmStreamingMode: 'force_stream' },
    getConfig: async () => config,
    saveConfig: async () => undefined,
    checkCancelled: () => undefined,
    driver
  })
  return await executor.chatTools({
    caller: 'human.brain',
    messages: [],
    tools: []
  })
}

describe('ai llm finish reason', () => {
  it('treats a normally closed response without provider finish_reason as stop', async () => {
    const result = await run({
      chatTools: async () => ({
        message: new AIMessage({ content: 'complete answer' }),
        rawText: 'complete answer',
        streamed: true
      })
    })
    expect(result.finishReason).toBe('stop')
  })

  it('preserves max_tokens as a length termination', async () => {
    const result = await run({
      chatTools: async () => ({
        message: new AIMessage({ content: 'partial answer' }),
        rawText: 'partial answer',
        streamed: true,
        responseMetadata: { finish_reason: 'max_tokens' }
      })
    })
    expect(result.finishReason).toBe('length')
  })

  it('infers tool_calls only after the complete response has an assembled tool call', async () => {
    const result = await run({
      chatTools: async () => ({
        message: new AIMessage({
          content: 'I will inspect it',
          tool_calls: [{ id: 'call-1', name: 'read_file', args: {}, type: 'tool_call' }]
        }),
        streamed: true
      })
    })
    expect(result.finishReason).toBe('tool_calls')
  })
})

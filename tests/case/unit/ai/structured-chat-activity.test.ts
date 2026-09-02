import { describe, expect, it } from 'vitest'
import {
  runLlmCallWithActivity,
  runStructuredChatWithActivity
} from '../../../../src/main/services/ai/utils/structuredChatActivity'
import { classifyLlmCallRetry } from '../../../../src/main/services/ai/llmExecutor'
import type { AiLlmIoRecord, AiRunEvent } from '../../../../src/shared/types'

describe('ai unit structured chat activity', () => {
  it('resets streamed draft before a retry so stale chunks are not duplicated', async () => {
    let attempt = 0
    let visible = ''
    const result = await runLlmCallWithActivity({
      ctx: { runId: 'retry-run', sendEvent: () => undefined },
      runId: 'retry-run',
      system: 'system',
      user: 'user',
      telemetry: {
        actionType: 'llm_tool_calls',
        caller: 'human.brain',
        schemaName: 'brain',
        modelName: 'model',
        baseUrl: 'https://example.test/v1',
        streamingMode: 'force_stream'
      },
      maxAttempts: 2,
      classifyRetry: () => ({ retryable: true, message: 'retry', delayMs: 0 }),
      onTextDelta: (text) => {
        visible += text
      },
      onTextReset: () => {
        visible = ''
      },
      execute: async (observer) => {
        attempt += 1
        if (attempt === 1) {
          observer.onDelta?.('stale')
          throw new Error('network')
        }
        observer.onDelta?.('fresh')
        return { output: 'fresh', rawText: 'fresh', streamed: true }
      }
    })

    expect(result.output).toBe('fresh')
    expect(visible).toBe('fresh')
  })

  it('uses exponential backoff for provider capacity exhaustion', () => {
    const error = Object.assign(
      new Error('ResourceExhausted: Worker local total request limit reached (69/48)'),
      { status: 503 }
    )

    expect([1, 2, 3, 4, 5].map((attempt) => classifyLlmCallRetry(error, attempt))).toEqual(
      [2_000, 4_000, 8_000, 15_000, 15_000].map((delayMs) => ({
        retryable: true,
        message: error.message,
        delayMs
      }))
    )
  })

  it('records scripted structured output activity and llm io', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []

    const result = await runStructuredChatWithActivity({
      ctx: {
        runId: 'run-1',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runId: 'run-1',
      system: 'system prompt',
      user: 'user prompt',
      telemetry: {
        caller: 'human.brain',
        schemaName: 'human_brain_decision',
        providerKind: 'openai-compatible',
        modelName: 'scripted-llm',
        baseUrl: 'https://scripted.local/v1',
        streamingMode: 'force_non_stream',
        attempt: 1,
        contextBudgetSnapshot: {
          evaluationId: 'budget-1',
          basis: 'usage_plus_delta',
          budgetTokens: 1234,
          contextWindowTokens: 200000,
          compactionTriggerTokens: 160000,
          hasCompressibleHistory: true,
          usageAvailable: true,
          lastBrainInputTokens: 1000,
          deltaTokenEstimate: 234
        }
      },
      execute: async () => ({
        output: {
          ok: true
        },
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 40,
          cacheHitRate: 0.4,
          source: 'response_metadata'
        },
        responseMetadata: {
          usage: {
            prompt_tokens: 100
          }
        },
        usageMetadata: {
          input_tokens: 100
        }
      })
    })

    expect(result.output).toEqual({ ok: true })
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2)
    expect(llmIoRecords).toHaveLength(1)
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.brain',
      schemaName: 'human_brain_decision',
      providerKind: 'openai-compatible',
      contextBudgetSnapshot: {
        evaluationId: 'budget-1',
        basis: 'usage_plus_delta',
        budgetTokens: 1234,
        contextWindowTokens: 200000,
        compactionTriggerTokens: 160000,
        hasCompressibleHistory: true,
        usageAvailable: true,
        lastBrainInputTokens: 1000,
        deltaTokenEstimate: 234
      },
      stablePrefixHash: expect.any(String),
      dynamicContextHash: expect.any(String),
      usage: {
        cachedInputTokens: 40
      },
      responseMetadata: {
        usage: {
          prompt_tokens: 100
        }
      },
      usageMetadata: {
        input_tokens: 100
      }
    })
  })

  it('records streamed text deltas and stream metadata', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []

    const result = await runLlmCallWithActivity({
      ctx: {
        runId: 'run-2',
        sendEvent: (event) => events.push(event),
        recordLlmIo: (record) => llmIoRecords.push(record)
      },
      runId: 'run-2',
      taskId: 'task-1',
      system: 'system prompt',
      user: 'user prompt',
      telemetry: {
        actionType: 'llm_text_output',
        caller: 'human.mouth',
        schemaName: 'human_mouth_markdown',
        modelName: 'scripted-llm',
        baseUrl: 'https://scripted.local/v1',
        streamingMode: 'force_stream',
        attempt: 1,
        contextBudgetSnapshot: {
          evaluationId: 'budget-ignore-1',
          basis: 'usage_plus_delta',
          budgetTokens: 999,
          contextWindowTokens: 200000,
          compactionTriggerTokens: 160000,
          hasCompressibleHistory: true,
          usageAvailable: true,
          lastBrainInputTokens: 900,
          deltaTokenEstimate: 99
        }
      },
      execute: async (observer) => {
        observer.onDelta?.('Hello')
        observer.onDelta?.(' world')
        return {
          output: 'Hello world',
          rawText: 'Hello world',
          streamed: true
        }
      }
    })

    expect(result.output).toBe('Hello world')

    const streamEvents = events.filter((event) => event.type === 'llm_stream_delta')
    expect(streamEvents).toHaveLength(2)
    expect(streamEvents[0]).toMatchObject({
      type: 'llm_stream_delta',
      runId: 'run-2',
      taskId: 'task-1',
      caller: 'human.mouth',
      chunkIndex: 1,
      text: 'Hello',
      internal: true
    })

    const completedActivity = events
      .filter((event) => event.type === 'activity')
      .find((event) => event.type === 'activity' && event.status === 'completed')
    expect(completedActivity).toMatchObject({
      type: 'activity',
      actionType: 'llm_text_output',
      status: 'completed',
      details: {
        streamingMode: 'force_stream',
        streamed: true,
        chunkCount: 2
      }
    })

    expect(llmIoRecords).toHaveLength(1)
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.mouth',
      schemaName: 'human_mouth_markdown',
      rawText: 'Hello world',
      streamingMode: 'force_stream',
      streamed: true,
      chunkCount: 2,
      status: 'completed'
    })
    expect(llmIoRecords[0]?.contextBudgetSnapshot).toBeUndefined()
  })

  it('records failed human.brain llm io with context budget snapshot', async () => {
    const events: AiRunEvent[] = []
    const llmIoRecords: AiLlmIoRecord[] = []

    await expect(
      runStructuredChatWithActivity({
        ctx: {
          runId: 'run-3',
          sendEvent: (event) => events.push(event),
          recordLlmIo: (record) => llmIoRecords.push(record)
        },
        runId: 'run-3',
        system: 'system prompt',
        user: 'user prompt',
        telemetry: {
          caller: 'human.brain',
          schemaName: 'human_brain_decision',
          providerKind: 'openai-compatible',
          modelName: 'scripted-llm',
          baseUrl: 'https://scripted.local/v1',
          streamingMode: 'force_non_stream',
          attempt: 1,
          contextBudgetSnapshot: {
            evaluationId: 'budget-2',
            basis: 'usage_plus_delta',
            budgetTokens: 2345,
            contextWindowTokens: 200000,
            compactionTriggerTokens: 160000,
            hasCompressibleHistory: false,
            usageAvailable: true,
            lastBrainInputTokens: 2000,
            deltaTokenEstimate: 345
          }
        },
        execute: async () => {
          throw new Error('structured_output_failed')
        }
      })
    ).rejects.toThrow('structured_output_failed')

    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.brain',
      schemaName: 'human_brain_decision',
      contextBudgetSnapshot: {
        evaluationId: 'budget-2',
        basis: 'usage_plus_delta',
        budgetTokens: 2345,
        contextWindowTokens: 200000,
        compactionTriggerTokens: 160000,
        hasCompressibleHistory: false,
        usageAvailable: true,
        lastBrainInputTokens: 2000,
        deltaTokenEstimate: 345
      },
      status: 'failed',
      reason: 'structured_output_failed'
    })
    const failedActivity = events
      .filter((event) => event.type === 'activity')
      .find((event) => event.type === 'activity' && event.status === 'failed')
    expect(failedActivity).toMatchObject({
      type: 'activity',
      actionType: 'llm_structured_output',
      status: 'failed',
      details: {
        reason: 'error'
      }
    })
  })

  it('emits retry process events with the provider error message', async () => {
    const events: AiRunEvent[] = []
    let callCount = 0

    const result = await runLlmCallWithActivity({
      ctx: {
        runId: 'run-4',
        sendEvent: (event) => events.push(event)
      },
      runId: 'run-4',
      system: 'system prompt',
      user: 'user prompt',
      telemetry: {
        actionType: 'llm_text_output',
        caller: 'human.mouth',
        schemaName: 'human_mouth_markdown',
        modelName: 'scripted-llm',
        baseUrl: 'https://scripted.local/v1',
        streamingMode: 'force_non_stream'
      },
      maxAttempts: 3,
      classifyRetry: (error) => ({
        retryable: error instanceof Error && error.message.includes('429'),
        message: 'Rate limit exceeded'
      }),
      execute: async () => {
        callCount += 1
        if (callCount === 1) {
          throw new Error('429 Rate limit exceeded')
        }
        return {
          output: 'ok',
          rawText: 'ok'
        }
      }
    })

    expect(result.output).toBe('ok')
    expect(callCount).toBe(2)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_process_group_started',
        kind: 'retry',
        display: {
          kind: 'retry',
          attempt: 2,
          maxAttempts: 3,
          message: 'Rate limit exceeded'
        }
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_process_item_started',
        display: {
          kind: 'retry',
          attempt: 2,
          maxAttempts: 3,
          message: 'Rate limit exceeded'
        }
      })
    )
  })

  it('passes the current attempt to retry classification and uses its delay', async () => {
    const events: AiRunEvent[] = []
    const classifyAttempts: number[] = []
    let callCount = 0
    const startedAt = Date.now()

    await runLlmCallWithActivity({
      ctx: {
        runId: 'run-retry-delay',
        sendEvent: (event) => events.push(event)
      },
      runId: 'run-retry-delay',
      system: 'system prompt',
      user: 'user prompt',
      telemetry: {
        actionType: 'llm_text_output',
        caller: 'human.mouth',
        schemaName: 'human_mouth_markdown',
        modelName: 'scripted-llm',
        baseUrl: 'https://scripted.local/v1',
        streamingMode: 'force_non_stream'
      },
      maxAttempts: 2,
      classifyRetry: (_error, attempt) => {
        classifyAttempts.push(attempt)
        return { retryable: true, message: 'capacity exhausted', delayMs: 20 }
      },
      execute: async () => {
        callCount += 1
        if (callCount === 1) throw new Error('ResourceExhausted')
        return { output: 'ok', rawText: 'ok' }
      }
    })

    expect(classifyAttempts).toEqual([1])
    expect(callCount).toBe(2)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15)
  })
})

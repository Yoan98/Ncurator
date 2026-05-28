import { describe, expect, it } from 'vitest'
import {
  runLlmCallWithActivity,
  runStructuredChatWithActivity
} from '../../../src/main/services/ai/utils/structuredChatActivity'
import type { AiLlmIoRecord, AiRunEvent } from '../../../src/shared/types'

describe('ai unit structured chat activity', () => {
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
        method: 'scripted',
        profile: 'scripted',
        fallbackChain: ['scripted'],
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
    expect(result.method).toBe('scripted')
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2)
    expect(llmIoRecords).toHaveLength(1)
    expect(llmIoRecords[0]?.method).toBe('scripted')
    expect(llmIoRecords[0]?.profile).toBe('scripted')
    expect(llmIoRecords[0]?.fallbackChain).toEqual(['scripted'])
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
          transport: 'responses',
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
        chunkCount: 2,
        transport: 'responses'
      }
    })

    expect(llmIoRecords).toHaveLength(1)
    expect(llmIoRecords[0]).toMatchObject({
      caller: 'human.mouth',
      schemaName: 'human_mouth_markdown',
      rawText: 'Hello world',
      transport: 'responses',
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
})

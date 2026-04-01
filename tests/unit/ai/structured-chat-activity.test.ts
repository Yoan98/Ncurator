import { describe, expect, it } from 'vitest'
import { runStructuredChatWithActivity } from '../../../src/main/services/ai/utils/structuredChatActivity'
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
        caller: 'unit.test',
        schemaName: 'unit_schema',
        modelName: 'scripted-llm',
        baseUrl: 'https://scripted.local/v1',
        attempt: 1
      },
      execute: async () => ({
        output: {
          ok: true
        },
        method: 'scripted',
        fallbackChain: ['scripted']
      })
    })

    expect(result.output).toEqual({ ok: true })
    expect(result.method).toBe('scripted')
    expect(events.filter((event) => event.type === 'activity')).toHaveLength(2)
    expect(llmIoRecords).toHaveLength(1)
    expect(llmIoRecords[0]?.method).toBe('scripted')
    expect(llmIoRecords[0]?.fallbackChain).toEqual(['scripted'])
  })
})

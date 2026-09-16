import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { reduceAssistantProcessGroups } from '../../../harness/core/assistantProcessGroups'

const retryStarted = (
  groupId: string,
  attempt: number,
  createdAt: number
): AiRunEvent => ({
  type: 'assistant_process_group_started',
  runId: 'run-1',
  groupId,
  kind: 'retry',
  display: {
    kind: 'retry',
    attempt,
    maxAttempts: 5,
    message: '429'
  },
  createdAt
})

describe('assistant process retry groups', () => {
  it('keeps a single retry row when attempts and later LLM calls reuse the run', () => {
    const first = reduceAssistantProcessGroups([], retryStarted('run-1:llm-retry:call-a', 1, 10))
    const second = reduceAssistantProcessGroups(first, retryStarted('run-1:llm-retry:call-a', 2, 20))
    const nextCall = reduceAssistantProcessGroups(
      second,
      retryStarted('run-1:llm-retry:call-b', 1, 30)
    )
    const retryGroups = nextCall.filter((group) => group.kind === 'retry')
    expect(retryGroups).toHaveLength(1)
    expect(retryGroups[0].status).toBe('running')
    expect(retryGroups[0].createdAt).toBe(10)
    expect(retryGroups[0].id).toBe('run-1:llm-retry:call-a')
    expect(second.filter((group) => group.kind === 'retry')[0]?.runningText.map((segment) => segment.text).join('')).toContain(
      '2/5'
    )
  })
})

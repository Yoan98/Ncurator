import { describe, expect, it } from 'vitest'
import { createSubagentDispatcher } from '../../../../src/main/services/ai/run/subagents'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from '../../../../src/main/services/ai/types'
import type { AiRunEvent, SubagentUpdate } from '../../../../src/shared/types'

describe('ai unit subagent retry display', () => {
  it('publishes retry state while the child model call is retrying and clears it afterwards', async () => {
    const updates: SubagentUpdate[] = []
    const controller = new AbortController()
    const payload = {
      runId: 'parent-run',
      partnerId: 'partner-1',
      input: '派发审核'
    } as AiRunStartPayload
    const deps = {
      subagentStore: {
        enqueue: () => [
          { agentId: 'agent-1', name: 'rv2', task: '审核视频', status: 'queued' as const }
        ],
        publish: () => undefined
      },
      chatMessageLogStore: {},
      sendEvent: (event: AiRunEvent) => {
        if (event.type === 'subagent_updated') updates.push(event.update)
      },
      isCancelled: () => false,
      abortSignal: controller.signal
    } as unknown as AiRunDeps

    const run = async (
      childPayload: AiRunStartPayload,
      childDeps: AiRunDeps
    ): Promise<AiRunState> => {
      childDeps.sendEvent({
        type: 'assistant_process_group_started',
        runId: childPayload.runId,
        groupId: `${childPayload.runId}:llm-retry`,
        kind: 'retry',
        display: { kind: 'retry', attempt: 2, maxAttempts: 5, message: 'llm_call_timeout' },
        createdAt: Date.now()
      })
      childDeps.sendEvent({
        type: 'assistant_process_group_completed',
        runId: childPayload.runId,
        groupId: `${childPayload.runId}:llm-retry`,
        completedAt: Date.now()
      })
      return {
        status: 'completed',
        finalDeliveryMarkdown: '审核完成',
        finalArtifacts: []
      } as unknown as AiRunState
    }

    const dispatch = createSubagentDispatcher(
      payload,
      deps,
      async () => ({}) as never,
      run
    )
    const children = await dispatch([{ name: 'rv2', instruction: '审核视频' }], 'delegate-1')

    const retryUpdates = updates.filter((update) => update.retry !== undefined)
    expect(retryUpdates.map((update) => update.retry)).toEqual([
      null,
      { attempt: 2, maxAttempts: 5 },
      null
    ])
    expect(children).toHaveLength(1)
    expect(children[0]?.status).toBe('completed')
    expect(children[0]?.retry).toBeUndefined()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import {
  getPartnerDigestCoordinator,
  resetPartnerDigestCoordinatorForTests
} from '../../../../src/main/services/ai/human/memory/partnerDigestCoordinator'
import { settleStalePendingDigests } from '../../../../src/main/services/ai/human/node/brainNode/runDigest'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../src/shared/types'

afterEach(() => {
  resetPartnerDigestCoordinatorForTests()
})

describe('partner digest coordinator', () => {
  it('lets the current run finish without waiting and blocks the next partner send', async () => {
    const coordinator = getPartnerDigestCoordinator()
    let generateStartedAt = 0
    let generateFinishedAt = 0
    let awaitedAt = 0
    coordinator.enqueue({
      partnerId: 'partner-1',
      runId: 'run-1',
      work: async () => {
        generateStartedAt = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 80))
        generateFinishedAt = Date.now()
      }
    })
    expect(coordinator.hasRun('run-1')).toBe(true)
    const enqueueReturnedAt = Date.now()
    await coordinator.awaitIdle('partner-1')
    awaitedAt = Date.now()
    expect(enqueueReturnedAt).toBeLessThan(generateFinishedAt)
    expect(awaitedAt).toBeGreaterThanOrEqual(generateFinishedAt)
    expect(generateStartedAt).toBeGreaterThan(0)
    expect(coordinator.hasRun('run-1')).toBe(false)
  })

  it('keeps run completion ahead of digest and writes the next user only after digest settles', async () => {
    const coordinator = getPartnerDigestCoordinator()
    const seq: string[] = []
    coordinator.enqueue({
      partnerId: 'partner-1',
      runId: 'run-1',
      work: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        seq.push('digest-completed')
      }
    })
    seq.push('run-completed')
    await coordinator.awaitIdle('partner-1')
    seq.push('next-user')
    expect(seq).toEqual(['run-completed', 'digest-completed', 'next-user'])
  })

  it('settles leftover pending digests to failed when no in-memory job exists', async () => {
    const records: ChatMessageLogRecord[] = [
      {
        id: '1',
        partnerId: 'partner-1',
        runId: 'run-old',
        seq: 1,
        createdAt: 1,
        entry: {
          kind: 'user',
          content: '写周报',
          input: '写周报',
          context: { selectedReferences: [], attachments: [] }
        }
      },
      {
        id: '2',
        partnerId: 'partner-1',
        runId: 'run-old',
        seq: 2,
        createdAt: 2,
        entry: { kind: 'assistant', content: '已写完', toolCalls: [] }
      },
      {
        id: '3',
        partnerId: 'partner-1',
        runId: 'run-old',
        seq: 3,
        createdAt: 3,
        entry: {
          kind: 'annotation',
          eventType: 'run_digest',
          payload: { status: 'pending', summary: '', fileChangePaths: ['/tmp/a.docx'] }
        }
      }
    ]
    const appended: ChatMessageLogEntry[] = []
    await settleStalePendingDigests({
      loadMessageLog: async () => records,
      appendMessageLog: async (entries, options) => {
        expect(options?.runId).toBe('run-old')
        appended.push(...entries)
      }
    })
    expect(appended).toEqual([
      {
        kind: 'annotation',
        eventType: 'run_digest',
        payload: { status: 'failed', summary: '', fileChangePaths: ['/tmp/a.docx'] }
      }
    ])
  })
})

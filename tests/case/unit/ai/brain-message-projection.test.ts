import { describe, expect, it } from 'vitest'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../src/shared/types'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import { resolveHistoryFloor } from '../../../../src/main/services/ai/human/memory/transcript'
import {
  isCompactedBrainUserMessage,
  isCurrentBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const user = (content: string, input = content): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input,
  context: { selectedReferences: [], attachments: [] }
})

const assistant = (content: string): ChatMessageLogEntry => ({
  kind: 'assistant',
  content,
  toolCalls: []
})

const checkpoint = (throughSeq: number, summary = '目标：已写周报'): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'compaction_checkpoint',
  payload: {
    compactBlockId: 'checkpoint-1',
    throughSeq,
    sourceMessageCount: 2,
    summary
  }
})

const records = (entries: Array<{ runId: string; entry: ChatMessageLogEntry }>) =>
  entries.map(
    ({ runId, entry }, index): ChatMessageLogRecord => ({
      id: `log-${index + 1}`,
      partnerId: 'partner-1',
      runId,
      seq: index + 1,
      entry,
      createdAt: Date.UTC(2026, 2, 14, 8, 20) + index
    })
  )

const createCtx = (): AiRunContext =>
  ({
    runId: 'run-new',
    partnerId: 'partner-1',
    partnerName: '测试伙伴',
    platform: 'macos',
    workspaceRoots: ['/tmp/workspace'],
    runStartedAt: Date.UTC(2026, 2, 14, 9, 0),
    preference: 'default',
    executionPermission: 'review',
    referenceScope: { selectedReferences: [], attachments: [] }
  }) as AiRunContext

describe('history floor', () => {
  it('uses the latest compaction checkpoint and ignores older ones', () => {
    const log = records([
      { runId: 'run-1', entry: user('old') },
      { runId: 'run-1', entry: assistant('old-done') },
      { runId: 'run-1', entry: checkpoint(2, '旧摘要') },
      { runId: 'run-2', entry: user('kept') },
      { runId: 'run-2', entry: assistant('kept-done') },
      { runId: 'run-2', entry: checkpoint(5, '新摘要') }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(5)
    expect(floor.compactionCheckpoint?.throughSeq).toBe(5)
    expect(floor.compactionCheckpoint?.summary).toBe('新摘要')
  })

  it('has no floor when the log has never compacted', () => {
    const floor = resolveHistoryFloor(
      records([
        { runId: 'run-1', entry: user('keep-me') },
        { runId: 'run-1', entry: assistant('kept') }
      ])
    )
    expect(floor.historyFloorSeq).toBe(-1)
    expect(floor.compactionCheckpoint).toBeUndefined()
  })
})

describe('brain message projection', () => {
  const ctx = createCtx()

  it('projects history originals plus the current user when nothing has been compacted', () => {
    const projection = projectBrainMessagesFromLog({
      records: records([
        { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>', 'fill weekly report') },
        { runId: 'run-1', entry: assistant('week report written') }
      ]),
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' })
    })
    expect(projection.messages.some((message) => isCompactedBrainUserMessage(message))).toBe(false)
    expect(String(projection.messages[0]?.content)).toContain('fill weekly report')
    expect(String(projection.messages[1]?.content)).toContain('week report written')
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
    expect(String(projection.messages.at(-1)?.content)).toContain('把标题改一下')
  })

  it('projects Compact User then retained originals then the current user', () => {
    const projection = projectBrainMessagesFromLog({
      records: records([
        { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>', 'fill weekly report') },
        { runId: 'run-1', entry: assistant('week report written') },
        { runId: 'run-1', entry: checkpoint(2) },
        { runId: 'run-2', entry: user('<user_context>excel task</user_context>', 'excel task') },
        { runId: 'run-2', entry: assistant('excel done') }
      ]),
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' })
    })
    expect(isCompactedBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(String(projection.messages[0]?.content)).toContain('目标：已写周报')
    expect(String(projection.messages.map((message) => message.content).join('\n'))).not.toContain(
      'fill weekly report'
    )
    expect(String(projection.messages.map((message) => message.content).join('\n'))).toContain('excel task')
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
  })

  it('does not append the current user when asked not to', () => {
    const projection = projectBrainMessagesFromLog({
      records: records([
        { runId: 'run-1', entry: user('fill weekly report') },
        { runId: 'run-1', entry: assistant('week report written') }
      ]),
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' }),
      appendCurrentUser: false
    })
    expect(projection.messages.some((message) => isCurrentBrainUserMessage(message))).toBe(false)
    expect(String(projection.messages.at(-1)?.content)).toContain('week report written')
  })

  it('rejects an empty historical user content', () => {
    expect(() =>
      projectBrainMessagesFromLog({
        records: records([{ runId: 'run-1', entry: user('   ', 'hello') }]),
        ctx,
        state: createInitialHumanState({ taskId: 'task-new', userInput: '继续' })
      })
    ).toThrow(/content 不能为空/)
  })
})

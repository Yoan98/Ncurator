import { describe, expect, it } from 'vitest'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import {
  projectMessageLogRecords,
  resolveCompactionThroughSeq
} from '../../../../src/main/services/ai/human/memory/transcript'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import { wrapCompactionCheckpointContent } from '../../../../src/main/services/ai/human/prompts/compaction'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const user = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input: content,
  context: {
    selectedReferences: [],
    attachments: []
  }
})

const checkpoint = (input: {
  throughSeq: number
  sourceMessageCount?: number
  summary?: string
  compactBlockId?: string
}): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'compaction_checkpoint',
  payload: {
    compactBlockId: input.compactBlockId || 'checkpoint-1',
    throughSeq: input.throughSeq,
    sourceMessageCount: input.sourceMessageCount ?? 2,
    summary: input.summary || '目标：已写周报'
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
      createdAt: index + 1
    })
  )

describe('ai human message-log recovery', () => {
  it('projects only records after the checkpoint covered sequence', () => {
    const projection = projectMessageLogRecords(
      records([
        { runId: 'run-1', entry: user('old secret that must be compacted') },
        {
          runId: 'run-1',
          entry: { kind: 'assistant', content: 'old answer', toolCalls: [] }
        },
        {
          runId: 'run-2',
          entry: checkpoint({
            compactBlockId: 'checkpoint-1',
            throughSeq: 2,
            sourceMessageCount: 2,
            summary: '目标：已写周报'
          })
        },
        { runId: 'run-2', entry: user('continue from summary') },
        {
          runId: 'run-2',
          entry: { kind: 'assistant', content: 'new answer', toolCalls: [] }
        }
      ])
    )

    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(projection.compactionCheckpoint?.throughSeq).toBe(2)
    expect(projection.compactionCheckpoint?.compactBlockId).toBe('checkpoint-1')
    expect(projection.messages.every((message) => message.getType() !== 'human')).toBe(true)
    expect(text).not.toContain('continue from summary')
    expect(text).not.toContain('<historical_user_turn>')
    expect(text).toContain('new answer')
    expect(text).not.toContain('old secret that must be compacted')
  })

  it('keeps the latest unfinished plan and clears it after normal finalization', () => {
    const unfinished = records([
      { runId: 'run-1', entry: user('do work') },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'plan_updated',
          payload: { plan: [{ title: 'inspect files', status: 'todo' }] }
        }
      }
    ])
    expect(projectMessageLogRecords(unfinished).plan).toEqual([
      { title: 'inspect files', status: 'todo' }
    ])

    const finalized: ChatMessageLogRecord[] = [
      ...unfinished,
      {
        id: 'log-3',
        partnerId: 'partner-1',
        runId: 'run-1',
        seq: 3,
        entry: { kind: 'annotation', eventType: 'finalizing_started', payload: {} },
        createdAt: 3
      }
    ]
    expect(projectMessageLogRecords(finalized).plan).toEqual([])
  })

  it('sets throughSeq through the last user when no process follows', () => {
    const log = records([
      { runId: 'run-1', entry: user('fill weekly report') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'week report written', toolCalls: [] }
      },
      { runId: 'run-2', entry: user('change the title') }
    ])
    expect(resolveCompactionThroughSeq(log)).toBe(3)
    expect(resolveCompactionThroughSeq(log, 0)).toBe(3)
  })

  it('covers the current user and dropped process while leaving the kept tail', () => {
    const log = records([
      { runId: 'run-1', entry: user('fill weekly report') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'reading last week', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '1',
          toolName: 'docx_read_nodes',
          ok: true,
          content: 'last week'
        }
      },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'writing draft', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '2',
          toolName: 'docx_content_edit',
          ok: true,
          content: 'draft'
        }
      }
    ])
    expect(resolveCompactionThroughSeq(log, 0)).toBe(5)
    expect(resolveCompactionThroughSeq(log, 2)).toBe(3)
    expect(resolveCompactionThroughSeq(log, 4)).toBe(1)
  })

  it('sets throughSeq through the message before a kept user when the tail includes that user', () => {
    const log = records([
      { runId: 'run-1', entry: user('fill weekly report') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'reading last week', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '1',
          toolName: 'docx_read_nodes',
          ok: true,
          content: 'last week'
        }
      },
      { runId: 'run-1', entry: user('change the title') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'writing draft', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '2',
          toolName: 'docx_content_edit',
          ok: true,
          content: 'draft'
        }
      }
    ])
    expect(resolveCompactionThroughSeq(log, 3)).toBe(3)
  })

  it('projects retained tail process after the compacted user when throughSeq sits before the tail', () => {
    const summary = '目标：\n写周报'
    const compactedUser = wrapCompactionCheckpointContent(summary)
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'reading last week', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '1',
          toolName: 'docx_read_nodes',
          ok: true,
          content: 'last week'
        }
      },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'writing draft', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'tool',
          toolCallId: '2',
          toolName: 'docx_content_edit',
          ok: true,
          content: 'draft'
        }
      },
      {
        runId: 'run-1',
        entry: checkpoint({
          compactBlockId: 'checkpoint-1',
          throughSeq: 3,
          sourceMessageCount: 3,
          summary
        })
      }
    ])
    const ctx = {
      platform: 'macos',
      runId: 'run-2',
      partnerId: 'partner-1',
      partnerName: '测试伙伴',
      workspaceRoots: ['/tmp/workspace'],
      runStartedAt: 0,
      preference: 'default',
      executionPermission: 'review',
      referenceScope: { selectedReferences: [], attachments: [] }
    } as AiRunContext
    const state = createInitialHumanState({
      taskId: 'task-after-compact-retained-tail',
      userInput: '对照周报改标题'
    })
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state
    })
    expect(projection.messages.map((message) => message.getType())).toEqual([
      'human',
      'ai',
      'tool',
      'human'
    ])
    expect(String(projection.messages[0]?.content)).toBe(compactedUser)
    expect(String(projection.messages[1]?.content)).toBe('writing draft')
    expect(String(projection.messages[2]?.content)).toBe('draft')
    expect(String(projection.messages[3]?.content)).toContain('对照周报改标题')
  })

  it('projects the compacted user then a new user without copying memory', () => {
    const summary = '目标：\n- 已写周报'
    const compactedUser = wrapCompactionCheckpointContent(summary)
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'week report written', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: checkpoint({
          compactBlockId: 'checkpoint-1',
          throughSeq: 2,
          sourceMessageCount: 2,
          summary
        })
      }
    ])
    const ctx = {
      platform: 'macos',
      runId: 'run-2',
      partnerId: 'partner-1',
      partnerName: '测试伙伴',
      workspaceRoots: ['/tmp/workspace'],
      runStartedAt: 0,
      preference: 'default',
      executionPermission: 'review',
      referenceScope: { selectedReferences: [], attachments: [] }
    } as AiRunContext
    const state = createInitialHumanState({
      taskId: 'task-after-compact',
      userInput: '把标题改为九月第一周'
    })
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state
    })
    const humans = projection.messages.filter((message) => message.getType() === 'human')
    expect(humans).toHaveLength(2)
    expect(projection.messages.some((message) => message.getType() === 'ai')).toBe(false)
    expect(String(humans[0]?.content)).toBe(compactedUser)
    expect(String(humans[1]?.content)).toContain('把标题改为九月第一周')
    expect(String(humans[1]?.content)).not.toContain('<memory>')
    expect(String(humans[1]?.content)).not.toContain('<active_state>')
    expect(String(humans[1]?.content)).not.toContain('fill weekly report')
  })

  it('puts the compacted user in front of leftover process after a compaction_checkpoint', () => {
    const summary = '目标：\n- 尚未生成文件'
    const compactedUser = wrapCompactionCheckpointContent(summary)
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'reading last week report', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: checkpoint({
          compactBlockId: 'checkpoint-1',
          throughSeq: 2,
          sourceMessageCount: 2,
          summary
        })
      },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'week report generated', toolCalls: [] }
      }
    ])
    const ctx = {
      platform: 'macos',
      runId: 'run-2',
      partnerId: 'partner-1',
      partnerName: '测试伙伴',
      workspaceRoots: ['/tmp/workspace'],
      runStartedAt: 0,
      preference: 'default',
      executionPermission: 'review',
      referenceScope: { selectedReferences: [], attachments: [] }
    } as AiRunContext
    const state = createInitialHumanState({
      taskId: 'task-after-compact-tail',
      userInput: '对照周报改标题'
    })
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state
    })
    expect(projection.messages.map((message) => message.getType())).toEqual([
      'human',
      'ai',
      'human'
    ])
    expect(String(projection.messages[0]?.content)).toBe(compactedUser)
    expect(String(projection.messages[1]?.content)).toBe('week report generated')
    expect(String(projection.messages[2]?.content)).toContain('对照周报改标题')
    expect(String(projection.messages[2]?.content)).not.toContain('<memory>')
    expect(String(projection.messages[2]?.content)).not.toContain('<active_state>')
    expect(String(projection.messages[2]?.content)).not.toContain('fill weekly report')
  })
})

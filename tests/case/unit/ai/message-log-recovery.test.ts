import { describe, expect, it } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord,
  ChatMessageLogUserOrigin
} from '../../../../src/shared/types'
import {
  projectMessageLogRecords,
  repairInterruptedToolCalls,
  resolveCompactionCoveredThroughSeq
} from '../../../../src/main/services/ai/human/memory/transcript'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const user = (
  content: string,
  origin: ChatMessageLogUserOrigin = 'human'
): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  origin,
  context: {
    selectedReferences: [],
    attachments: []
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
          entry: {
            kind: 'annotation',
            eventType: 'compaction_checkpoint',
            payload: {
              compactBlockId: 'checkpoint-1',
              coveredThroughSeq: 2,
              sourceMessageCount: 2
            }
          }
        },
        { runId: 'run-2', entry: user('continue from summary') },
        {
          runId: 'run-2',
          entry: { kind: 'assistant', content: 'new answer', toolCalls: [] }
        }
      ])
    )

    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(projection.checkpoint?.coveredThroughSeq).toBe(2)
    expect(projection.checkpoint?.compactBlockId).toBe('checkpoint-1')
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

  it('drops history before the latest context_cleared cut, including older checkpoints', () => {
    const projection = projectMessageLogRecords(
      records([
        { runId: 'run-1', entry: user('secret before clear') },
        {
          runId: 'run-1',
          entry: { kind: 'assistant', content: 'old answer', toolCalls: [] }
        },
        {
          runId: 'run-1',
          entry: {
            kind: 'annotation',
            eventType: 'compaction_checkpoint',
            payload: {
              compactBlockId: 'checkpoint-old',
              coveredThroughSeq: 2,
              sourceMessageCount: 2
            }
          }
        },
        {
          runId: 'run-2',
          entry: { kind: 'annotation', eventType: 'context_cleared', payload: {} }
        },
        { runId: 'run-3', entry: user('new request after clear') },
        {
          runId: 'run-3',
          entry: { kind: 'assistant', content: 'fresh answer', toolCalls: [] }
        }
      ])
    )

    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(projection.checkpoint).toBeUndefined()
    expect(text).not.toContain('secret before clear')
    expect(text).not.toContain('old answer')
    expect(text).not.toContain('must not enter next brain')
    expect(text).toContain('fresh answer')
  })

  it('repairs a dangling tool call with the same tool_call_id', () => {
    const repaired = repairInterruptedToolCalls([
      new AIMessage({
        content: 'calling tool',
        tool_calls: [{ id: 'call-1', name: 'read_file', args: {}, type: 'tool_call' }]
      })
    ])
    expect(repaired).toHaveLength(2)
    expect(repaired[1]).toBeInstanceOf(ToolMessage)
    expect((repaired[1] as ToolMessage).tool_call_id).toBe('call-1')
    expect(String(repaired[1].content)).toContain('interrupted')
  })

  it('bookmarks coveredThroughSeq from the whole partner log, not only the current run', () => {
    const log = records([
      { runId: 'run-1', entry: user('fill weekly report') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'week report written', toolCalls: [] }
      },
      { runId: 'run-2', entry: user('change the title') }
    ])
    expect(resolveCompactionCoveredThroughSeq(log)).toBe(2)
  })

  it('brain projection drops history before context_cleared including older checkpoints', () => {
    const log = records([
      { runId: 'run-1', entry: user('<user_context>secret before clear</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'old answer', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'compaction_checkpoint',
          payload: {
            compactBlockId: 'checkpoint-old',
            coveredThroughSeq: 2,
            sourceMessageCount: 2
          }
        }
      },
      {
        runId: 'run-1',
        entry: user(
          '<user_context>secret before clear\n<memory>must not enter next brain</memory></user_context>',
          'compaction'
        )
      },
      {
        runId: 'run-2',
        entry: { kind: 'annotation', eventType: 'context_cleared', payload: {} }
      }
    ])
    const ctx = {
      platform: 'macos',
      runId: 'run-3',
      partnerId: 'partner-1',
      partnerName: '测试伙伴',
      workspaceRoots: ['/tmp/workspace'],
      runStartedAt: 0,
      preference: 'default',
      executionPermission: 'review',
      referenceScope: { selectedReferences: [], attachments: [] }
    } as AiRunContext
    const state = createInitialHumanState({
      taskId: 'task-after-clear',
      userInput: 'new request after clear'
    })
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state
    })
    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(text).not.toContain('secret before clear')
    expect(text).not.toContain('old answer')
    expect(text).not.toContain('must not enter next brain')
    expect(text).toContain('new request after clear')
    expect(text).not.toContain('<memory>')
    expect(text).not.toContain('<active_state>')
  })

  it('projects the compacted user then a new user without copying memory', () => {
    const compactedUser =
      '<user_context>\n填周报\n<memory>\n当前交付：\n- 已写周报\n历史事实：\n- 无\n</memory>\n</user_context>'
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'week report written', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'compaction_checkpoint',
          payload: {
            compactBlockId: 'checkpoint-1',
            coveredThroughSeq: 2,
            sourceMessageCount: 2
          }
        }
      },
      { runId: 'run-1', entry: user(compactedUser, 'compaction') }
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

  it('puts the compacted user in front of leftover process after a checkpoint', () => {
    const compactedUser =
      '<user_context>\n填周报\n<memory>\n当前交付：\n- 尚未生成文件\n</memory>\n</user_context>'
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      {
        runId: 'run-1',
        entry: { kind: 'assistant', content: 'reading last week report', toolCalls: [] }
      },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'compaction_checkpoint',
          payload: {
            compactBlockId: 'checkpoint-1',
            coveredThroughSeq: 2,
            sourceMessageCount: 2
          }
        }
      },
      { runId: 'run-1', entry: user(compactedUser, 'compaction') },
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

import { describe, expect, it } from 'vitest'
import {
  mergeConversationMessages,
  projectAiConversationMessages
} from '../../../../src/shared/workbench/conversationProjection'
import type { AiRunRecord, ChatMessage, ChatMessageLogRecord } from '../../../../src/shared/types'

const buildRun = (input: Partial<AiRunRecord> & { id: string }): AiRunRecord => ({
  id: input.id,
  partnerId: input.partnerId || 'partner-1',
  userMessageId: input.userMessageId || `${input.id}-user`,
  assistantMessageId: input.assistantMessageId || `${input.id}-assistant`,
  status: input.status || 'completed',
  input: input.input || `input-${input.id}`,
  partialAnswer: input.partialAnswer || input.finalAnswer || 'answer',
  finalAnswer: input.finalAnswer || 'answer',
  createdAt: input.createdAt || 10,
  updatedAt: input.updatedAt || 11,
  finishedAt: input.finishedAt || 11,
  ...input
})

const buildLogRecord = (input: {
  runId: string
  seq: number
  entry: ChatMessageLogRecord['entry']
  createdAt?: number
}): ChatMessageLogRecord => ({
  id: `${input.runId}-${input.seq}`,
  partnerId: 'partner-1',
  runId: input.runId,
  seq: input.seq,
  entry: input.entry,
  createdAt: input.createdAt ?? input.seq
})

describe('conversationProjection', () => {
  it('projects user and delivery assistant per run from log and run metadata', () => {
    const runs = [
      buildRun({
        id: 'run-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        input: 'hello',
        finalAnswer: 'world'
      })
    ]
    const records = [
      buildLogRecord({
        runId: 'run-1',
        seq: 1,
        entry: {
          kind: 'user',
          content: 'hello',
          origin: 'human',
          context: { selectedReferences: [], attachments: [] }
        }
      }),
      buildLogRecord({
        runId: 'run-1',
        seq: 2,
        entry: { kind: 'assistant', content: 'thinking', toolCalls: [{ id: 'tool-1', name: 'grep', arguments: '{}' }] }
      }),
      buildLogRecord({
        runId: 'run-1',
        seq: 3,
        entry: { kind: 'assistant', content: 'world', toolCalls: [] }
      })
    ]

    const messages = projectAiConversationMessages({
      partnerId: 'partner-1',
      records,
      runs
    })

    expect(messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'world' })
  })

  it('uses run.input for the bubble and skips compaction users', () => {
    const runs = [
      buildRun({
        id: 'run-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        input: '写周报',
        finalAnswer: '已写好'
      })
    ]
    const records = [
      buildLogRecord({
        runId: 'run-1',
        seq: 1,
        entry: {
          kind: 'user',
          content: '<user_context>写周报</user_context>',
          origin: 'human',
          context: { selectedReferences: [], attachments: [] }
        }
      }),
      buildLogRecord({
        runId: 'run-1',
        seq: 2,
        entry: {
          kind: 'user',
          content: '<user_context>写周报\n<memory>当前交付：- 已写周报</memory></user_context>',
          origin: 'compaction',
          context: { selectedReferences: [], attachments: [] }
        }
      }),
      buildLogRecord({
        runId: 'run-1',
        seq: 3,
        entry: { kind: 'assistant', content: '已写好', toolCalls: [] }
      })
    ]

    const messages = projectAiConversationMessages({
      partnerId: 'partner-1',
      records,
      runs
    })

    expect(messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1'])
    expect(messages[0]).toMatchObject({ role: 'user', content: '写周报' })
    expect(messages[0]?.content).not.toContain('<user_context>')
    expect(messages[0]?.content).not.toContain('<memory>')
  })

  it('shows active assistant bubble while run is still running', () => {
    const runs = [
      buildRun({
        id: 'run-1',
        status: 'running',
        partialAnswer: '',
        finalAnswer: undefined,
        finishedAt: undefined
      })
    ]

    const messages = projectAiConversationMessages({
      partnerId: 'partner-1',
      records: [],
      runs
    })

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '' })
  })

  it('merges search turns without duplicating ai message ids', () => {
    const aiMessages: ChatMessage[] = [
      {
        id: 'user-1',
        partner_id: 'partner-1',
        role: 'user',
        content: 'ai',
        timestamp: 1
      }
    ]
    const searchMessages: ChatMessage[] = [
      {
        id: 'search-1',
        partner_id: 'partner-1',
        role: 'user',
        content: 'search query',
        timestamp: 2
      },
      {
        id: 'user-1',
        partner_id: 'partner-1',
        role: 'user',
        content: 'duplicate',
        timestamp: 3
      }
    ]

    const merged = mergeConversationMessages({
      aiMessages,
      legacyMessages: searchMessages
    })

    expect(merged.map((message) => message.id)).toEqual(['user-1', 'search-1'])
  })
})

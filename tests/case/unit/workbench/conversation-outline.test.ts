import { describe, expect, it } from 'vitest'
import {
  buildConversationOutline,
  MAX_OUTLINE_ITEMS,
  outlinePreviewText,
  resolveConversationQuestion
} from '../../../../src/shared/workbench/conversationOutline'
import { startOfLocalDay } from '../../../../src/shared/workbench/messageTimeline'
import type { ChatMessage } from '../../../../src/shared/types'

const DAY = new Date(2026, 10, 18, 10, 0, 0).valueOf()
const NEXT_DAY = DAY + 24 * 60 * 60 * 1000

const message = (
  id: string,
  role: ChatMessage['role'],
  content: string,
  timestamp: number
): ChatMessage => ({
  id,
  partner_id: 'p',
  role,
  content,
  timestamp
})

describe('outlinePreviewText', () => {
  it('collapses multiple lines into a preview', () => {
    expect(outlinePreviewText('## 结论\n\n第一段内容\n第二段内容')).toBe(
      '结论 第一段内容 第二段内容'
    )
  })

  it('strips list markers but keeps inline markdown', () => {
    expect(outlinePreviewText('- **加粗** 与 `code`\n- 第二条')).toBe('**加粗** 与 `code` 第二条')
  })

  it('keeps link labels and media descriptions without their paths', () => {
    expect(
      outlinePreviewText(
        '已完成 [brief.md](</Users/me/My Docs/brief.md>)，见 ![演示视频](/tmp/demo(1).mp4)。'
      )
    ).toBe('已完成 brief.md，见 演示视频。')
  })

  it('uses surrounding prose or the code itself for code-only replies', () => {
    expect(outlinePreviewText('说明\n```ts\nconst a = 1\n```\n尾部')).toBe('说明 尾部')
    expect(outlinePreviewText('```ts\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('returns empty text for whitespace-only input', () => {
    expect(outlinePreviewText('   \n\n')).toBe('')
  })
})

describe('buildConversationOutline', () => {
  it('keeps only messages of the scoped day', () => {
    const items = buildConversationOutline({
      dayStart: startOfLocalDay(DAY),
      messages: [
        message('a', 'user', '今天的问题', DAY),
        message('b', 'assistant', '今天的回答', DAY + 1000),
        message('c', 'user', '昨天的问题', DAY - 24 * 60 * 60 * 1000)
      ]
    })
    expect(items.map((item) => item.id)).toEqual(['a'])
    expect(items[0]).toMatchObject({ kind: 'user', title: '今天的问题', snippet: '今天的回答' })
  })

  it('falls back to the latest day when no day is selected', () => {
    const items = buildConversationOutline({
      dayStart: null,
      messages: [message('a', 'user', '旧消息', DAY), message('b', 'user', '新消息', NEXT_DAY)]
    })
    expect(items.map((item) => item.id)).toEqual(['b'])
  })

  it('skips empty assistant placeholders and system notices', () => {
    const items = buildConversationOutline({
      dayStart: startOfLocalDay(DAY),
      messages: [
        message('a', 'assistant', '   ', DAY),
        message('b', 'system', '系统提示', DAY),
        message('c', 'user', '真实消息', DAY),
        message('d', 'assistant', '   ', DAY + 1),
        { ...message('e', 'assistant', '失败：连接错误', DAY + 2), error: true },
        message('f', 'user', ' ', DAY + 3)
      ]
    })
    expect(items.map((item) => item.id)).toEqual(['c'])
    expect(items[0]).toMatchObject({ title: '真实消息', snippet: '' })
  })

  it('prefers the latest final answer, then the latest non-empty reply from that question', () => {
    const messages = [
      message('q1', 'user', '第一问\n补充', DAY),
      message('final-1', 'assistant', '旧的最终回答', DAY + 1),
      message('q2', 'user', '第二问', DAY + 2),
      { ...message('final-2', 'assistant', '最新的最终回答', DAY + 3), userMessageId: 'q1' },
      { ...message('partial-1', 'assistant', '第一问的后续回复', DAY + 4), userMessageId: 'q1' },
      message('partial-2', 'assistant', '第二问的旧回复', DAY + 5),
      message('partial-3', 'assistant', '第二问的最新回复', DAY + 6),
      message('empty', 'assistant', '\n ', DAY + 7)
    ]

    const items = buildConversationOutline({
      dayStart: startOfLocalDay(DAY),
      messages,
      resolveReply: (item) => ({ text: item.content, final: item.id.startsWith('final-') })
    })

    expect(items.map(({ id, title, snippet }) => ({ id, title, snippet }))).toEqual([
      { id: 'q1', title: '第一问 补充', snippet: '最新的最终回答' },
      { id: 'q2', title: '第二问', snippet: '第二问的最新回复' }
    ])
  })

  it('buckets tick length by content size', () => {
    const items = buildConversationOutline({
      dayStart: startOfLocalDay(DAY),
      messages: [
        message('short', 'user', '短', DAY),
        message('medium', 'user', 'x'.repeat(400), DAY + 1),
        message('long', 'user', 'x'.repeat(1200), DAY + 2)
      ]
    })
    expect(items.map((item) => item.lengthLevel)).toEqual([1, 2, 3])
  })

  it('keeps an answer with its question across midnight and queued user messages', () => {
    const question = message('question', 'user', '跨天问题', DAY)
    const queued = message('queued', 'user', '追加问题', NEXT_DAY)
    const answer = {
      ...message('answer', 'assistant', 'x'.repeat(900), NEXT_DAY + 1),
      userMessageId: question.id
    }
    const messages = [question, queued, answer]
    expect(buildConversationOutline({ messages, dayStart: startOfLocalDay(DAY) })).toEqual([
      expect.objectContaining({ id: question.id, kind: 'user', lengthLevel: 3 })
    ])
    expect(resolveConversationQuestion(messages, answer.id)?.id).toBe(question.id)
    expect(buildConversationOutline({ messages, dayStart: null }).map((item) => item.id)).toEqual([
      question.id
    ])
    expect(
      buildConversationOutline({ messages, dayStart: startOfLocalDay(NEXT_DAY) }).map(
        (item) => item.id
      )
    ).toEqual([queued.id])
  })

  it('samples long days while keeping the first and last item', () => {
    const messages = Array.from({ length: MAX_OUTLINE_ITEMS * 2 }, (_, index) =>
      message(`m${String(index)}`, 'user', `第 ${String(index)} 条`, DAY + index)
    )
    const items = buildConversationOutline({ dayStart: startOfLocalDay(DAY), messages })
    expect(items).toHaveLength(MAX_OUTLINE_ITEMS)
    expect(items[0].id).toBe('m0')
    expect(items[items.length - 1].id).toBe(`m${String(messages.length - 1)}`)
  })
})

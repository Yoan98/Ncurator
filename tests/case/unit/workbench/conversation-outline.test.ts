import { describe, expect, it } from 'vitest'
import {
  buildConversationOutline,
  buildOutlinePreview,
  MAX_OUTLINE_ITEMS
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

describe('buildOutlinePreview', () => {
  it('takes the first line as title and the rest as snippet', () => {
    const preview = buildOutlinePreview('## 结论\n\n第一段内容\n第二段内容')
    expect(preview.title).toBe('结论')
    expect(preview.snippet).toBe('第一段内容 第二段内容')
  })

  it('strips list markers but keeps inline markdown', () => {
    const preview = buildOutlinePreview('- **加粗** 与 `code`\n- 第二条')
    expect(preview.title).toBe('**加粗** 与 `code`')
    expect(preview.snippet).toBe('第二条')
  })

  it('drops fenced code blocks', () => {
    const preview = buildOutlinePreview('说明\n```ts\nconst a = 1\n```\n尾部')
    expect(preview.title).toBe('说明')
    expect(preview.snippet).toBe('尾部')
  })

  it('returns an empty pair for whitespace-only input', () => {
    expect(buildOutlinePreview('   \n\n')).toEqual({ title: '', snippet: '' })
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
    expect(items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(items[0]).toMatchObject({ kind: 'user', title: '今天的问题' })
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
        message('c', 'user', '真实消息', DAY)
      ]
    })
    expect(items.map((item) => item.id)).toEqual(['c'])
  })

  it('buckets tick length by content size', () => {
    const items = buildConversationOutline({
      dayStart: startOfLocalDay(DAY),
      messages: [
        message('short', 'user', '短', DAY),
        message('medium', 'assistant', 'x'.repeat(400), DAY + 1),
        message('long', 'assistant', 'x'.repeat(1200), DAY + 2)
      ]
    })
    expect(items.map((item) => item.lengthLevel)).toEqual([1, 2, 3])
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

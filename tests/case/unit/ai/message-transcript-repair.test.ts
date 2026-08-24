import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import {
  deriveMessageLogMessages,
  repairInterruptedToolCalls
} from '../../../../src/main/services/ai/human/memory/transcript'
import type { ChatMessageLogEntry } from '../../../../src/shared/types'

const assistantWithCalls = (ids: string[]): AIMessage =>
  new AIMessage({
    content: '调用工具',
    tool_calls: ids.map((id) => ({ id, name: 'docx_search', args: {}, type: 'tool_call' as const }))
  })

const toolResult = (id: string): ToolMessage =>
  new ToolMessage({ content: '{"ok":true}', tool_call_id: id })

describe('ai unit message transcript repair', () => {
  it('skips only the last user entry when skipLastUserEntry is set', () => {
    const entries: ChatMessageLogEntry[] = [
      { kind: 'user', content: '第一个诉求' },
      {
        kind: 'assistant',
        content: '先学习技能',
        toolCalls: [{ id: 'call-1', name: 'learn_skill', args: { skillIds: ['docx-read'] } }]
      },
      { kind: 'tool', toolCallId: 'call-1', toolName: 'learn_skill', ok: true, result: { ok: true } },
      { kind: 'user', content: '第二个诉求' }
    ]

    const skipped = deriveMessageLogMessages({ entries, skipLastUserEntry: true })
    expect(skipped.map((message) => message.getType())).toEqual(['human', 'ai', 'tool'])
    expect(skipped[0].content).toBe('第一个诉求')
    expect(skipped.some((message) => message.content === '第二个诉求')).toBe(false)

    const all = deriveMessageLogMessages({ entries, skipLastUserEntry: false })
    expect(all.map((message) => message.getType())).toEqual(['human', 'ai', 'tool', 'human'])
  })

  it('inserts interrupted ToolMessage for an assistant with dangling tool calls', () => {
    const repaired = repairInterruptedToolCalls([assistantWithCalls(['x', 'y'])])

    expect(repaired.map((message) => message.getType())).toEqual(['ai', 'tool', 'tool'])
    const toolMessages = repaired.filter((message) => message.getType() === 'tool') as ToolMessage[]
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['x', 'y'])
    for (const message of toolMessages) {
      expect(message.content).toContain('"status":"fail"')
      expect(message.content).toContain('interrupted')
    }
  })

  it('only inserts interrupted ToolMessage for the missing tool call id', () => {
    const repaired = repairInterruptedToolCalls([
      assistantWithCalls(['x', 'y']),
      toolResult('x')
    ])

    expect(repaired.map((message) => message.getType())).toEqual(['ai', 'tool', 'tool'])
    const toolMessages = repaired.filter((message) => message.getType() === 'tool') as ToolMessage[]
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['x', 'y'])
    expect(toolMessages[0].content).toBe('{"ok":true}')
    expect(toolMessages[1].content).toContain('interrupted')
  })

  it('keeps messages unchanged when every tool call already has a result', () => {
    const repaired = repairInterruptedToolCalls([assistantWithCalls(['x']), toolResult('x')])
    expect(repaired.map((message) => message.getType())).toEqual(['ai', 'tool'])
    expect(repaired[0]).toBeInstanceOf(AIMessage)
    expect(repaired[1]).toBeInstanceOf(ToolMessage)
    expect((repaired[1] as ToolMessage).content).toBe('{"ok":true}')
  })

  it('does not touch human or system messages', () => {
    const repaired = repairInterruptedToolCalls([new HumanMessage('用户消息')])
    expect(repaired.map((message) => message.getType())).toEqual(['human'])
  })
})

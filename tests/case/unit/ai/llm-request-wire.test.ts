import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import {
  diffChatToolsRequestWire,
  serializeChatToolsRequestWire
} from '../../../../src/main/services/ai/utils/llmRequestWire'

describe('ai unit llm request wire', () => {
  it('records assistant tool_calls arguments as the wire JSON string', () => {
    const wire = serializeChatToolsRequestWire({
      messages: [
        new SystemMessage('sys'),
        new HumanMessage('hi'),
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'docx_content_edit',
              args: { type: 'replace_text', nodeId: 'n1' },
              type: 'tool_call'
            }
          ]
        }),
        new ToolMessage({ content: 'ok', tool_call_id: 'call_1' })
      ],
      tools: []
    })
    expect(wire.messages.map((message) => message.role)).toEqual(['system', 'human', 'ai', 'tool'])
    expect(wire.messages[2]?.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'docx_content_edit',
        arguments: '{"type":"replace_text","nodeId":"n1"}'
      }
    ])
    expect(wire.messages[3]?.toolCallId).toBe('call_1')
    expect(wire.toolsHash).toHaveLength(64)
    expect(wire.messagesHash).toHaveLength(64)
  })

  it('points at the first mismatched assistant toolCalls', () => {
    const left = serializeChatToolsRequestWire({
      messages: [
        new AIMessage({
          content: 'same',
          tool_calls: [
            {
              id: 'call_1',
              name: 'docx_content_edit',
              args: { nodeId: 'n1', type: 'replace_text' },
              type: 'tool_call'
            }
          ]
        })
      ],
      tools: []
    })
    const right = serializeChatToolsRequestWire({
      messages: [
        new AIMessage({
          content: 'same',
          tool_calls: [
            {
              id: 'call_1',
              name: 'docx_content_edit',
              args: { type: 'replace_text', nodeId: 'n1' },
              type: 'tool_call'
            }
          ]
        })
      ],
      tools: []
    })
    const diff = diffChatToolsRequestWire(left, right)
    expect(diff.equal).toBe(false)
    expect(diff.toolsHashEqual).toBe(true)
    expect(diff.messagesHashEqual).toBe(false)
    expect(diff.firstPath).toBe('messages[0].toolCalls')
    expect(diff.firstDifferingMessageIndex).toBe(0)
  })
})

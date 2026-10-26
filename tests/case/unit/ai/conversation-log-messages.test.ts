import { describe, expect, it } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { ChatMessageLogEntry } from '../../../../src/shared/types'
import {
  appendLogEntriesToCache,
  messagesFromLogEntries
} from '../../../../src/main/services/ai/human/memory/conversationLogMessages'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { buildToolFeedback } from '../../../../src/main/services/ai/human/shared/toolFeedback'
import {
  readToolErrorMessage,
  resolveToolErrorMessage
} from '../../../../src/main/services/ai/human/shared/toolError'
import {
  renderGenericModelError,
  renderBrowserUseModelError,
  renderKbModelError,
  renderScheduledTaskModelError
} from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { repairInterruptedToolCalls } from '../../../../src/main/services/ai/human/memory/transcript'

const userEntry = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input: content,
  context: {
    selectedReferences: [],
    attachments: []
  }
})

describe('ai unit conversation log messages', () => {
  it.each(['load_skill', 'load_toolset', 'update_plan', 'ask_user'])(
    'defers images across split batches containing %s',
    (toolName) => {
      const entries: ChatMessageLogEntry[] = [
        {
          kind: 'assistant',
          content: '',
          toolCalls: [
            { id: 'image-a', name: 'read_image', args: {} },
            { id: 'other', name: toolName, args: {} },
            { id: 'image-b', name: 'read_image', args: {} }
          ]
        },
        {
          kind: 'tool',
          toolCallId: 'image-a',
          toolName: 'read_image',
          ok: true,
          content: 'a',
          images: [{ path: '/tmp/a.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1 }]
        },
        { kind: 'tool', toolCallId: 'other', toolName, ok: false, content: 'Error: failed' },
        {
          kind: 'tool',
          toolCallId: 'image-b',
          toolName: 'read_image',
          ok: true,
          content: 'b',
          images: [{ path: '/tmp/b.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1 }]
        }
      ]
      const cache = createHumanRuntimeCache()
      entries.forEach((entry, index) => {
        appendLogEntriesToCache(cache, [entry])
        if (index < entries.length - 1) {
          expect(cache.messages?.some((message) => message.getType() === 'human')).toBe(false)
        }
      })
      const projected = messagesFromLogEntries(entries)
      expect(cache.messages?.map((message) => message.toDict())).toEqual(
        projected.map((message) => message.toDict())
      )
      expect(projected.map((message) => message.getType())).toEqual([
        'ai',
        'tool',
        'tool',
        'tool',
        'human'
      ])
      expect(cache.conversationProjection?.pendingImages).toHaveLength(0)
    }
  )

  it('preserves images when rebuilding an interrupted batch and repairs results before them', () => {
    const entries: ChatMessageLogEntry[] = [
      {
        kind: 'assistant',
        content: '',
        toolCalls: [
          { id: 'image', name: 'read_image', args: {} },
          { id: 'learn', name: 'load_toolset', args: {} }
        ]
      },
      {
        kind: 'tool',
        toolCallId: 'image',
        toolName: 'read_image',
        ok: true,
        content: 'image',
        images: [{ path: '/tmp/a.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1 }]
      }
    ]
    const cache = createHumanRuntimeCache()
    appendLogEntriesToCache(cache, entries)
    expect(cache.messages?.map((message) => message.getType())).toEqual(['ai', 'tool'])
    const repaired = repairInterruptedToolCalls(messagesFromLogEntries(entries))
    expect(repaired.map((message) => message.getType())).toEqual(['ai', 'tool', 'tool', 'human'])
    expect((repaired[2] as ToolMessage).tool_call_id).toBe('learn')
    expect(JSON.stringify(repaired[3].content)).toContain(encodeURIComponent('/tmp/a.png'))
  })

  it('keeps original assistant tool call args and order when projecting', () => {
    const entry: ChatMessageLogEntry = {
      kind: 'assistant',
      content: '读取节点',
      toolCalls: [
        {
          id: 'call-schema-invalid',
          name: 'docx_read_nodes',
          args: {
            range: { fromNodeIndex: 0, toNodeIndex: 15 },
            sourcePath: '/tmp/本周周报.docx',
            type: 'node_index'
          }
        },
        {
          id: 'call-ok',
          name: 'load_toolset',
          args: { toolsetNames: ['docx-read'] }
        }
      ]
    }

    const [message] = messagesFromLogEntries([entry])
    expect(message).toBeInstanceOf(AIMessage)
    const toolCalls = (message as AIMessage).tool_calls
    expect(toolCalls).toEqual([
      {
        id: 'call-schema-invalid',
        name: 'docx_read_nodes',
        args: {
          range: { fromNodeIndex: 0, toNodeIndex: 15 },
          sourcePath: '/tmp/本周周报.docx',
          type: 'node_index'
        },
        type: 'tool_call'
      },
      {
        id: 'call-ok',
        name: 'load_toolset',
        args: { toolsetNames: ['docx-read'] },
        type: 'tool_call'
      }
    ])
  })

  it('builds tool results and image messages from the same log entries as cache append', () => {
    const entries: ChatMessageLogEntry[] = [
      userEntry('看图'),
      {
        kind: 'assistant',
        content: '读取图片',
        toolCalls: [{ id: 'image-a', name: 'read_image', args: { paths: ['/tmp/a.png'] } }]
      },
      {
        kind: 'tool',
        toolCallId: 'image-a',
        toolName: 'read_image',
        ok: true,
        content: 'a',
        images: [{ path: '/tmp/a.png', mimeType: 'image/png', sizeBytes: 10, width: 1, height: 1 }]
      }
    ]

    const projected = messagesFromLogEntries(entries)
    const cache = createHumanRuntimeCache()
    appendLogEntriesToCache(cache, entries)
    const cached = cache.messages || []

    expect(cached.map((message) => message.getType())).toEqual(
      projected.map((message) => message.getType())
    )
    expect(String(cached[0]?.content)).toBe(String(projected[0]?.content))
    expect((cached[1] as AIMessage).tool_calls).toEqual((projected[1] as AIMessage).tool_calls)
    expect((cached[2] as ToolMessage).content).toBe((projected[2] as ToolMessage).content)
    expect((cached[2] as ToolMessage).tool_call_id).toBe((projected[2] as ToolMessage).tool_call_id)
    expect(JSON.stringify(cached[3]?.content)).toBe(JSON.stringify(projected[3]?.content))
    expect(projected.map((message) => message.getType())).toEqual(['human', 'ai', 'tool', 'human'])
    expect(projected[2]).toBeInstanceOf(ToolMessage)
    expect(JSON.stringify(projected[3]?.content)).toContain(encodeURIComponent('/tmp/a.png'))
  })

  it('skips annotations so they never become request messages', () => {
    const messages = messagesFromLogEntries([
      {
        kind: 'annotation',
        eventType: 'thinking_started',
        payload: {}
      },
      {
        kind: 'assistant',
        content: '开始',
        toolCalls: []
      }
    ])
    expect(messages.map((message) => message.getType())).toEqual(['ai'])
    expect(String(messages[0]?.content)).toBe('开始')
  })
})

describe('ai unit tool feedback text', () => {
  it('preserves explicit success text in the model message and transcript', () => {
    const transcript = buildToolFeedback({
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      content: 'Plan updated successfully.'
    })
    const message = messagesFromLogEntries([transcript])[0]

    expect(String(message?.content)).toBe('Plan updated successfully.')
    expect(transcript).toEqual({
      kind: 'tool',
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      content: String(message?.content)
    })
  })

  it('preserves Unicode diagnostics in the model message and transcript', () => {
    const transcript = buildToolFeedback({
      toolCallId: 'call-2',
      toolName: 'update_plan',
      ok: false,
      errorMessage: 'status 仅允许 todo/done'
    })
    const message = messagesFromLogEntries([transcript])[0]

    expect(String(message?.content)).toBe('Error: status 仅允许 todo/done')
    expect(transcript.content).toBe(String(message?.content))
    expect(transcript.error).toBe('status 仅允许 todo/done')
  })

  it.each(['', '   ', undefined])(
    'uses an English fallback only for an empty diagnostic: %s',
    (errorMessage) => {
      const entry = buildToolFeedback({
        toolCallId: 'fallback',
        toolName: 'text_file_read',
        ok: false,
        errorMessage
      })
      expect(entry.content).toBe('Error: Tool text_file_read failed.')
      expect(entry.error).toBe('Tool text_file_read failed.')
    }
  )

  it('retains explicit failure content as the error reason', () => {
    const entry = buildToolFeedback({
      toolCallId: 'denied',
      toolName: 'terminal_run',
      ok: false,
      content: 'Error: Approval denied. 用户要求停止。'
    })
    expect(entry.error).toBe('Approval denied. 用户要求停止。')
    expect(entry.content).toBe('Error: Approval denied. 用户要求停止。')
  })

  it('does not let a generic custom message overwrite a known error', () => {
    const entry = buildToolFeedback({
      toolCallId: 'failed',
      toolName: 'test',
      ok: false,
      errorMessage: 'ENOENT: /文档/周报',
      content: 'The operation failed.'
    })
    expect(entry.content).toContain('ENOENT: /文档/周报')
    expect(entry.error).toBe('ENOENT: /文档/周报')
  })

  it('extracts existing errors without stringifying unknown objects', () => {
    expect(readToolErrorMessage(new Error('原始异常\nDetails: /文档/周报'))).toBe(
      '原始异常\nDetails: /文档/周报'
    )
    expect(readToolErrorMessage({ error: ' ', message: 'Actual diagnostic' })).toBe(
      'Actual diagnostic'
    )
    expect(resolveToolErrorMessage('test', { other: true })).toBe('Tool test failed.')
    expect(resolveToolErrorMessage('', new Error(''))).toBe('Tool call failed.')
  })

  it.each(['文件不存在：/文档/周报.docx', 'EACCES: /文档/周报.docx', '失败原因\nDetails: timeout'])(
    'keeps execution diagnostics unchanged: %s',
    (error) => {
      expect(
        renderGenericModelError({ toolName: 'text_file_read', args: {}, data: { error } })
      ).toBe(`Error: ${error}`)
    }
  )

  it('uses the same fallback for generic and specialized renderers', () => {
    for (const render of [renderGenericModelError, renderScheduledTaskModelError])
      expect(render({ toolName: 'test', args: {}, data: { error: ' ' } })).toBe(
        'Error: Tool test failed.'
      )
  })

  it('preserves browser error and context even when a separate message is present', () => {
    const rendered = renderBrowserUseModelError({
      toolName: 'browser_use',
      args: {},
      data: { action: 'act', error: '原始失败', message: 'Action failed', tabId: 'tab-1' }
    })
    expect(rendered).toContain('原始失败')
    expect(rendered).toContain('Action failed')
    expect(rendered).toContain('tab-1')
  })

  it('keeps KB business errors and its recovery guidance', () => {
    const rendered = renderKbModelError({
      toolName: 'kb_search',
      args: {},
      data: { error: 'The knowledge base index is being updated.' }
    })
    expect(rendered).toContain('Error: The knowledge base index is being updated.')
    expect(rendered).toContain('Do not call KB tools again')
  })
})

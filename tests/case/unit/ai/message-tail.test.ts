import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import {
  renderMessagesForCompaction,
  splitMessagesByLastAi
} from '../../../../src/main/services/ai/human/node/utils/messageTail'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  args,
  type: 'tool_call' as const
})

describe('splitMessagesByLastAi', () => {
  it('excludes system and human templates from compressible', () => {
    const messages = [
      new SystemMessage('<system>fixed template</system>'),
      new HumanMessage('<user_context>task goal</user_context>'),
      new AIMessage({ content: '', tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })] }),
      new ToolMessage({ content: 'total 1', tool_call_id: '1' }),
      new AIMessage({ content: '', tool_calls: [toolCall('2', 'text_file_read', { sourcePath: 'a.txt' })] })
    ]
    const { compressible, tail } = splitMessagesByLastAi(messages)
    expect(compressible.map((m) => m.getType())).toEqual(['ai', 'tool'])
    expect(tail.map((m) => m.getType())).toEqual(['ai'])
  })

  it('keeps the last AI message and everything after it as tail', () => {
    const messages = [
      new AIMessage({ content: '', tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })] }),
      new ToolMessage({ content: 'r1', tool_call_id: '1' }),
      new AIMessage({ content: '', tool_calls: [toolCall('2', 'text_file_read', { sourcePath: 'a.txt' })] }),
      new ToolMessage({ content: 'r2', tool_call_id: '2' })
    ]
    const { compressible, tail } = splitMessagesByLastAi(messages)
    expect(compressible.map((m) => m.getType())).toEqual(['ai', 'tool'])
    expect(tail.map((m) => m.getType())).toEqual(['ai', 'tool'])
    expect((tail[1] as ToolMessage).content).toBe('r2')
  })

  it('returns empty compressible when there is no AI message', () => {
    const messages = [new SystemMessage('sys'), new HumanMessage('user')]
    expect(splitMessagesByLastAi(messages)).toEqual({ compressible: [], tail: [] })
  })
})

describe('renderMessagesForCompaction', () => {
  it('renders thought and tool calls as separate lines within a round', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '先看目录',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'cd /tmp && ls' })]
      })
    ])
    expect(rendered).toBe('[round 1]\n[ai] 先看目录\n[tool_call] terminal_run(command="cd /tmp && ls")')
  })

  it('renders only tool_call lines when the AI message has no content', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'docx_read_outline', { sourcePath: '工作/上周周报.docx' })]
      })
    ])
    expect(rendered).toBe('[round 1]\n[tool_call] docx_read_outline(sourcePath="工作/上周周报.docx")')
  })

  it('groups each AI message with its tool results and numbers rounds', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '读取并写入',
        tool_calls: [
          toolCall('1', 'text_file_read', { sourcePath: 'a.txt' }),
          toolCall('2', 'text_file_edit', { action: 'create', sourcePath: 'b.txt' })
        ]
      }),
      new ToolMessage({ content: 'hello', tool_call_id: '1' }),
      new ToolMessage({ content: 'created', tool_call_id: '2' }),
      new AIMessage({
        content: '',
        tool_calls: [toolCall('3', 'terminal_run', { command: 'ls' })]
      }),
      new ToolMessage({ content: 'total 1', tool_call_id: '3' })
    ])
    expect(rendered).toBe(
      [
        '[round 1]',
        '[ai] 读取并写入',
        '[tool_call] text_file_read(sourcePath="a.txt")',
        '[tool_call] text_file_edit(action="create", sourcePath="b.txt")',
        '[tool] hello',
        '[tool] created',
        '',
        '[round 2]',
        '[tool_call] terminal_run(command="ls")',
        '[tool] total 1'
      ].join('\n')
    )
  })

  it('trims leading and trailing whitespace from AI thoughts and tool results', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '材料齐了。\n\n',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })]
      }),
      new ToolMessage({ content: '\n\ntotal 1\n', tool_call_id: '1' })
    ])
    expect(rendered).toBe(
      '[round 1]\n[ai] 材料齐了。\n[tool_call] terminal_run(command="ls")\n[tool] total 1'
    )
  })

  it('preserves internal blank lines in tool output', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })]
      }),
      new ToolMessage({ content: '\nline 1\n\nline 3\n', tool_call_id: '1' })
    ])
    expect(rendered).toBe(
      '[round 1]\n[tool_call] terminal_run(command="ls")\n[tool] line 1\n\nline 3'
    )
  })

  it('json-stringifies nested args and truncates long values', () => {
    const long = 'x'.repeat(400)
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'terminal_run', { command: long, options: { a: 1 } })]
      })
    ])
    expect(rendered).toContain('[round 1]')
    expect(rendered).toContain('[tool_call] terminal_run(')
    expect(rendered).toContain('options={"a":1}')
    expect(rendered).toContain('…')
    expect(rendered.length).toBeLessThan(450)
  })
})

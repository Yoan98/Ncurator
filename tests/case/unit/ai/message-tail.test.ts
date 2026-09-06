import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import {
  renderMessagesForCompaction,
  listFoldableHistoryMessages,
  splitMessagesForMemoryCompaction,
  createCurrentBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  args,
  type: 'tool_call' as const
})

describe('splitMessagesForMemoryCompaction', () => {
  it('puts the current user and following process into current, earlier users before it', () => {
    const current = createCurrentBrainUserMessage('<user_context>current task</user_context>')
    const messages = [
      new SystemMessage('<system>fixed template</system>'),
      new HumanMessage('old task'),
      new AIMessage({ content: '', tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })] }),
      new ToolMessage({ content: 'total 1', tool_call_id: '1' }),
      current,
      new AIMessage({ content: '', tool_calls: [toolCall('2', 'text_file_read', { sourcePath: 'a.txt' })] }),
      new ToolMessage({ content: 'file body', tool_call_id: '2' })
    ]
    const split = splitMessagesForMemoryCompaction(messages)
    expect(split.earlier.map((message) => message.getType())).toEqual(['human', 'ai', 'tool'])
    expect(split.current.map((message) => message.getType())).toEqual(['human', 'ai', 'tool'])
    expect(split.current[0]).toBe(current)
  })

  it('keeps same-run process in current when there is no earlier user', () => {
    const current = createCurrentBrainUserMessage('fill weekly report')
    const split = splitMessagesForMemoryCompaction([
      new SystemMessage('sys'),
      current,
      new AIMessage({ content: 'reading', tool_calls: [toolCall('1', 'docx_read_nodes', {})] }),
      new ToolMessage({ content: 'nodes', tool_call_id: '1' })
    ])
    expect(split.earlier).toEqual([])
    expect(split.current).toHaveLength(3)
  })

  it('treats unmarked history as current when the current user marker is missing', () => {
    const split = splitMessagesForMemoryCompaction([
      new SystemMessage('sys'),
      new HumanMessage('user'),
      new AIMessage({ content: 'answer' })
    ])
    expect(split.earlier).toEqual([])
    expect(split.current.map((message) => message.getType())).toEqual(['human', 'ai'])
  })
})

describe('listFoldableHistoryMessages', () => {
  it('excludes system and the current user', () => {
    const current = createCurrentBrainUserMessage('now')
    const foldable = listFoldableHistoryMessages([
      new SystemMessage('sys'),
      new HumanMessage('old'),
      current,
      new AIMessage({ content: 'go' })
    ])
    expect(foldable.map((message) => message.getType())).toEqual(['human', 'ai'])
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

  it('renders a user message as its own round without extra blank lines inside the round', () => {
    const rendered = renderMessagesForCompaction([
      new HumanMessage('<user_context>\n  <task_goal>\n填周报\n  </task_goal>\n</user_context>'),
      new AIMessage({
        content: '先读',
        tool_calls: [toolCall('1', 'docx_read_nodes', { sourcePath: 'a.docx' })]
      }),
      new ToolMessage({ content: 'ok', tool_call_id: '1' })
    ])
    expect(rendered).toBe(
      [
        '[round 1]',
        '[user]',
        '<user_context>\n  <task_goal>\n填周报\n  </task_goal>\n</user_context>',
        '',
        '[round 2]',
        '[ai] 先读',
        '[tool_call] docx_read_nodes(sourcePath="a.docx")',
        '[tool] ok'
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

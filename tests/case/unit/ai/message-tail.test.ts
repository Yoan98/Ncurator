import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import {
  renderMessagesForCompaction,
  createCompactedBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  args,
  type: 'tool_call' as const
})

describe('renderMessagesForCompaction', () => {
  it('renders thought and tool calls without round markers', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '先看目录',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'cd /tmp && ls' })]
      })
    ])
    expect(rendered).toBe('[ai] 先看目录\n[tool_call] terminal_run(command="cd /tmp && ls")')
    expect(rendered).not.toContain('[round')
  })

  it('renders only tool_call lines when the AI message has no content', () => {
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'docx_read_outline', { sourcePath: '工作/上周周报.docx' })]
      })
    ])
    expect(rendered).toBe('[tool_call] docx_read_outline(sourcePath="工作/上周周报.docx")')
  })

  it('groups each AI message with its tool results and blanks between user and process blocks', () => {
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
        '[ai] 读取并写入',
        '[tool_call] text_file_read(sourcePath="a.txt")',
        '[tool_call] text_file_edit(action="create", sourcePath="b.txt")',
        '[tool] hello',
        '[tool] created',
        '[tool_call] terminal_run(command="ls")',
        '[tool] total 1'
      ].join('\n')
    )
  })

  it('renders a user and the following process in one turn without a blank line', () => {
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
        '[user]',
        '<user_context>\n  <task_goal>\n填周报\n  </task_goal>\n</user_context>',
        '[ai] 先读',
        '[tool_call] docx_read_nodes(sourcePath="a.docx")',
        '[tool] ok'
      ].join('\n')
    )
    expect(rendered).not.toContain('[round')
  })

  it('renders a checkpoint as a conversation user instead of a separate tag', () => {
    const rendered = renderMessagesForCompaction([
      createCompactedBrainUserMessage(
        'The conversation history before this point was compacted into the following summary:\n\n<summary>\n## 目标\n写周报\n</summary>'
      ),
      new AIMessage({ content: '继续写' }),
      new HumanMessage('改标题'),
      new AIMessage({ content: '好' })
    ])
    expect(rendered).toBe(
      [
        '[user]',
        'The conversation history before this point was compacted into the following summary:',
        '',
        '<summary>',
        '## 目标',
        '写周报',
        '</summary>',
        '[ai] 继续写',
        '',
        '[user]',
        '改标题',
        '[ai] 好'
      ].join('\n')
    )
    expect(rendered).not.toContain('<previous-summary>')
  })

  it('inserts a blank line only between turns', () => {
    const rendered = renderMessagesForCompaction([
      new HumanMessage('上周周报叫什么？'),
      new AIMessage({ content: '工作/上周周报-已发版.docx' }),
      new HumanMessage('按上周风格写本周周报'),
      new AIMessage({
        content: '先读上周',
        tool_calls: [toolCall('1', 'docx_read_outline', { sourcePath: '工作/上周周报-已发版.docx' })]
      }),
      new ToolMessage({ content: '标题、整体判断', tool_call_id: '1' })
    ])
    expect(rendered).toBe(
      [
        '[user]',
        '上周周报叫什么？',
        '[ai] 工作/上周周报-已发版.docx',
        '',
        '[user]',
        '按上周风格写本周周报',
        '[ai] 先读上周',
        '[tool_call] docx_read_outline(sourcePath="工作/上周周报-已发版.docx")',
        '[tool] 标题、整体判断'
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
    expect(rendered).toBe('[ai] 材料齐了。\n[tool_call] terminal_run(command="ls")\n[tool] total 1')
  })

  it('truncates compaction-input tool bodies to 2000 characters from the start', () => {
    const longBody = `${'line\n'.repeat(80)}end`
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })]
      }),
      new ToolMessage({ content: `\n${longBody}\n`, tool_call_id: '1' })
    ])
    expect(rendered).toContain('[tool] line')
    expect(rendered).toContain(longBody)
  })

  it('marks omitted characters when a tool body exceeds 2000 characters', () => {
    const longBody = 'x'.repeat(2500)
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'terminal_run', { command: 'ls' })]
      }),
      new ToolMessage({ content: longBody, tool_call_id: '1' })
    ])
    expect(rendered).toContain('[tool] ' + 'x'.repeat(2000))
    expect(rendered).toContain('... [500 characters omitted]')
    expect(rendered).not.toContain('x'.repeat(2001))
  })

  it('json-stringifies nested args and truncates long values', () => {
    const long = 'x'.repeat(400)
    const rendered = renderMessagesForCompaction([
      new AIMessage({
        content: '',
        tool_calls: [toolCall('1', 'terminal_run', { command: long, options: { a: 1 } })]
      })
    ])
    expect(rendered).not.toContain('[round')
    expect(rendered).toContain('[tool_call] terminal_run(')
    expect(rendered).toContain('options={"a":1}')
    expect(rendered).toContain('…')
    expect(rendered.length).toBeLessThan(450)
  })
})

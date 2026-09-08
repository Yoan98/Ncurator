import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import {
  renderMessagesForCompaction,
  splitMessagesForCompactionTail,
  hasCompressibleCompactionHistory,
  countTailBookmarkMessages,
  createCurrentBrainUserMessage,
  createCompactedBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { estimateMessagesForContext } from '../../../../src/main/services/ai/human/memory/multimodal'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  name,
  args,
  type: 'tool_call' as const
})

const aiToolPair = (id: string, aiText: string, toolText: string) => [
  new AIMessage({
    content: aiText,
    tool_calls: [toolCall(id, 'docx_read_nodes', { sourcePath: `${id}.docx` })]
  }),
  new ToolMessage({ content: toolText, tool_call_id: id })
]

describe('splitMessagesForCompactionTail', () => {
  it('keeps recent users in the tail instead of stopping at the last user', () => {
    const current = createCurrentBrainUserMessage('<user_context>current task</user_context>')
    const lastPair = aiToolPair('2', 'writing draft', 'draft body')
    const earlier = aiToolPair('1', 'x'.repeat(2000), 'y'.repeat(2000))
    const legal = aiToolPair('early', 'reading legal', 'legal body')
    const messages = [
      new SystemMessage('<system>fixed template</system>'),
      new HumanMessage('old task'),
      ...earlier,
      current,
      ...legal,
      ...lastPair
    ]
    const keep = estimateMessagesForContext([current, ...legal, ...lastPair]) + 32
    const split = splitMessagesForCompactionTail(messages, keep)
    expect(split.tail[0]).toBe(current)
    expect(split.tail.at(-1)).toBe(lastPair[1])
    expect(split.folded.map((message) => String(message.content))).toContain('old task')
    expect(split.folded).toContain(earlier[0])
  })

  it('does not split an assistant and its tool results', () => {
    const current = createCurrentBrainUserMessage('fill weekly report')
    const pair = [
      new AIMessage({
        content: 'read both',
        tool_calls: [
          toolCall('1', 'text_file_read', { sourcePath: 'a.txt' }),
          toolCall('2', 'text_file_read', { sourcePath: 'b.txt' })
        ]
      }),
      new ToolMessage({ content: 'aaa', tool_call_id: '1' }),
      new ToolMessage({ content: 'bbb', tool_call_id: '2' })
    ]
    const split = splitMessagesForCompactionTail(
      [new SystemMessage('sys'), current, ...pair],
      estimateMessagesForContext(pair) - 1
    )
    expect(split.tail).toEqual(pair)
    expect(split.folded).toEqual([current])
  })

  it('keeps a mid-turn split instead of snapping to the nearby user', () => {
    const older = new HumanMessage('old task')
    const user = new HumanMessage('u'.repeat(80))
    const firstPair = aiToolPair('1', 'a'.repeat(40), 't'.repeat(40))
    const lastPair = aiToolPair('2', 'b'.repeat(4000), 'c'.repeat(4000))
    const keep = estimateMessagesForContext([...firstPair, ...lastPair]) - 1
    const split = splitMessagesForCompactionTail(
      [new SystemMessage('sys'), older, ...aiToolPair('0', 'old', 'old'), user, ...firstPair, ...lastPair],
      keep
    )
    expect(split.isSplitTurn).toBe(true)
    expect(split.tail).toEqual(lastPair)
    expect(split.history[0]).toBe(older)
    expect(split.turnPrefix[0]).toBe(user)
    expect(split.folded[0]).toBe(older)
  })

  it('keeps a mid-turn split when the nearby user is farther than 10%', () => {
    const user = new HumanMessage('u'.repeat(80))
    const middle = aiToolPair('1', 'm'.repeat(8000), 'n'.repeat(8000))
    const lastPair = aiToolPair('2', 'b'.repeat(400), 'c'.repeat(400))
    const keep = estimateMessagesForContext(lastPair)
    const split = splitMessagesForCompactionTail(
      [new SystemMessage('sys'), user, ...middle, ...lastPair],
      keep
    )
    expect(split.tail).toEqual(lastPair)
    expect(split.folded[0]).toBe(user)
    expect(split.folded).toEqual([user, ...middle])
    expect(split.isSplitTurn).toBe(true)
    expect(split.history).toEqual([])
    expect(split.turnPrefix).toEqual([user, ...middle])
  })

  it('does not treat image-reference humans as a user boundary', () => {
    const current = createCurrentBrainUserMessage('look at the screenshot')
    const imageHuman = new HumanMessage({
      content: [{ type: 'text', text: 'image' }]
    })
    const pair = aiToolPair('1', 'reading image', 'ok')
    const split = splitMessagesForCompactionTail(
      [current, imageHuman, ...pair],
      estimateMessagesForContext(pair)
    )
    expect(split.folded[0]).toBe(current)
    expect(split.tail.at(-1)).toBe(pair[1])
    expect(split.tail).not.toContain(current)
  })

  it('keeps synthesized checkpoint users in folded history instead of dropping them', () => {
    const checkpoint = createCompactedBrainUserMessage('checkpoint summary')
    const current = createCurrentBrainUserMessage('continue')
    const tail = aiToolPair('2', 'current work', 'current result')
    const earlier = aiToolPair('1', 'old work', 'old result')
    const split = splitMessagesForCompactionTail(
      [checkpoint, new HumanMessage('old task'), ...earlier, current, ...tail],
      estimateMessagesForContext([current, ...tail])
    )
    expect(split.folded).toContain(checkpoint)
    expect(split.tail).not.toContain(checkpoint)
    expect(split.folded.map((message) => String(message.content))).toContain('old task')
  })

  it('does not treat a checkpoint user as the start of the leftover process turn', () => {
    const checkpoint = createCompactedBrainUserMessage('checkpoint summary')
    const leftover = aiToolPair('1', 'x'.repeat(2000), 'y'.repeat(2000))
    const lastPair = aiToolPair('2', 'b'.repeat(400), 'c'.repeat(400))
    const split = splitMessagesForCompactionTail(
      [new SystemMessage('sys'), checkpoint, ...leftover, ...lastPair],
      estimateMessagesForContext(lastPair)
    )
    expect(split.tail).toEqual(lastPair)
    expect(split.folded).toContain(checkpoint)
    expect(split.folded).toEqual([checkpoint, ...leftover])
    expect(split.isSplitTurn).toBe(false)
    expect(split.turnPrefix).toEqual([])
  })
})

describe('hasCompressibleCompactionHistory', () => {
  it('is false when only a checkpoint user sits outside the keep window', () => {
    const checkpoint = createCompactedBrainUserMessage('checkpoint summary')
    const current = createCurrentBrainUserMessage('continue')
    const tail = aiToolPair('2', 'current work', 'current result')
    expect(
      hasCompressibleCompactionHistory(
        [checkpoint, current, ...tail],
        estimateMessagesForContext([current, ...tail])
      )
    ).toBe(false)
  })

  it('is false when the keep window covers the whole conversation', () => {
    const current = createCurrentBrainUserMessage('fill weekly report')
    const pair = aiToolPair('1', 'reading', 'nodes')
    expect(
      hasCompressibleCompactionHistory(
        [new SystemMessage('sys'), current, ...pair],
        estimateMessagesForContext([current, ...pair]) + 32
      )
    ).toBe(false)
  })

  it('is true when a mid-turn split folds the current user', () => {
    const current = createCurrentBrainUserMessage('fill weekly report')
    const huge = aiToolPair('1', 'x'.repeat(4000), 'y'.repeat(4000))
    expect(
      hasCompressibleCompactionHistory(
        [current, ...huge],
        Math.floor(estimateMessagesForContext(huge) * 0.1)
      )
    ).toBe(true)
  })

  it('is true when earlier users or process remain after taking the tail', () => {
    const current = createCurrentBrainUserMessage('continue')
    const earlier = aiToolPair('1', 'old work', 'old result')
    const tail = aiToolPair('2', 'current work', 'current result')
    expect(
      hasCompressibleCompactionHistory(
        [new HumanMessage('old task'), ...earlier, current, ...tail],
        estimateMessagesForContext([current, ...tail])
      )
    ).toBe(true)
  })
})

describe('countTailBookmarkMessages', () => {
  it('counts users, ai and tool messages and ignores image humans', () => {
    expect(
      countTailBookmarkMessages([
        new HumanMessage('keep me'),
        new AIMessage({ content: 'go' }),
        new ToolMessage({ content: 'ok', tool_call_id: '1' }),
        new HumanMessage({ content: [{ type: 'text', text: 'image' }] })
      ])
    ).toBe(3)
  })
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

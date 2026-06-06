import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../src/shared/types'
import {
  buildAssistantProcessText,
  buildAssistantExecutionSummaryText,
  completeAssistantProcessGroups,
  createAssistantThinkingGroup,
  createSearchProcessGroup,
  reduceAssistantProcessGroups,
  reduceAssistantProcessThoughts
} from '../../../src/renderer/src/components/workbench/utils'

const toText = (segments: { text: string }[]): string =>
  segments.map((segment) => segment.text).join('')

const groupStarted = (overrides: {
  groupId: string
  kind: Extract<AiRunEvent, { type: 'assistant_process_group_started' }>['kind']
  display: Extract<AiRunEvent, { type: 'assistant_process_group_started' }>['display']
  createdAt?: number
}): AiRunEvent => ({
  type: 'assistant_process_group_started',
  runId: 'run-1',
  groupId: overrides.groupId,
  kind: overrides.kind,
  display: overrides.display,
  createdAt: overrides.createdAt || 1
})

const groupCompleted = (overrides: {
  groupId: string
  display?: Extract<AiRunEvent, { type: 'assistant_process_group_completed' }>['display']
  completedAt?: number
}): AiRunEvent => ({
  type: 'assistant_process_group_completed',
  runId: 'run-1',
  groupId: overrides.groupId,
  display: overrides.display,
  completedAt: overrides.completedAt || 2
})

const itemStarted = (overrides: {
  groupId: string
  itemId: string
  display: Extract<AiRunEvent, { type: 'assistant_process_item_started' }>['display']
  createdAt?: number
}): AiRunEvent => ({
  type: 'assistant_process_item_started',
  runId: 'run-1',
  groupId: overrides.groupId,
  itemId: overrides.itemId,
  display: overrides.display,
  createdAt: overrides.createdAt || 1
})

const itemCompleted = (overrides: {
  groupId: string
  itemId: string
  display?: Extract<AiRunEvent, { type: 'assistant_process_item_completed' }>['display']
  completedAt?: number
}): AiRunEvent => ({
  type: 'assistant_process_item_completed',
  runId: 'run-1',
  groupId: overrides.groupId,
  itemId: overrides.itemId,
  display: overrides.display,
  completedAt: overrides.completedAt || 2
})

describe('workbench assistant process groups', () => {
  it('collects public thought text from assistant_process_thought events', () => {
    const thoughts = reduceAssistantProcessThoughts([], {
      type: 'assistant_process_thought',
      runId: 'run-1',
      thoughtId: 'thought-1',
      text: '俺先看一下文档结构。',
      createdAt: 1
    })

    expect(thoughts).toEqual([
      {
        id: 'thought-1',
        text: '俺先看一下文档结构。',
        createdAt: 1,
        sourceEventType: 'assistant_process_thought'
      }
    ])
  })

  it('replaces local thinking placeholder with backend thinking event', () => {
    const groups = reduceAssistantProcessGroups(
      [createAssistantThinkingGroup('assistant-1')],
      groupStarted({
        groupId: 'run-1:thinking',
        kind: 'thinking',
        display: { kind: 'thinking' }
      })
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'run-1:thinking',
      kind: 'thinking',
      status: 'running'
    })
    expect(toText(groups[0].runningText)).toBe('让俺想想')
  })

  it('removes thinking group when backend marks thinking completed', () => {
    const startedGroups = reduceAssistantProcessGroups(
      [],
      groupStarted({
        groupId: 'run-1:thinking',
        kind: 'thinking',
        display: { kind: 'thinking' }
      })
    )
    const completedGroups = reduceAssistantProcessGroups(
      startedGroups,
      groupCompleted({
        groupId: 'run-1:thinking',
        display: { kind: 'thinking' }
      })
    )

    expect(completedGroups).toEqual([])
  })

  it('removes thinking group as soon as public decision text arrives', () => {
    const groups = reduceAssistantProcessGroups(
      [createAssistantThinkingGroup('assistant-1')],
      {
        type: 'assistant_process_thought',
        runId: 'run-1',
        thoughtId: 'thought-1',
        text: '先确认需要审批的本地命令。',
        createdAt: 2
      }
    )

    expect(groups).toEqual([])
  })

  it('groups docx read tools by skill and builds tool-specific sentences from input', () => {
    const groupId = 'run-1:skill:docx-reader'
    const group = groupStarted({
      groupId,
      kind: 'skill',
      display: {
        kind: 'tool',
        toolName: 'docx_outline',
        input: { sourcePath: '/tmp/report.docx' }
      }
    })
    const outline = itemStarted({
      groupId,
      itemId: 'tool-outline',
      display: {
        kind: 'tool',
        toolName: 'docx_outline',
        input: { sourcePath: '/tmp/report.docx' }
      },
      createdAt: 2
    })
    const readBlocks = itemStarted({
      groupId,
      itemId: 'tool-read',
      display: {
        kind: 'tool',
        toolName: 'docx_read_blocks',
        input: { sourcePath: '/tmp/report.docx' }
      },
      createdAt: 3
    })

    const groups = [group, outline, readBlocks].reduce(reduceAssistantProcessGroups, [])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: groupId,
      skillKey: 'docx-reader',
      status: 'running'
    })
    expect(toText(buildAssistantExecutionSummaryText(groups))).toBe('正在读取 1 个 docx 文件')
    expect(toText(groups[0].items[0].runningText)).toBe('正在阅读 /tmp/report.docx 文件的结构')
    expect(toText(groups[0].items[1].runningText)).toBe('正在读取 /tmp/report.docx 文件细节')
    expect(groups[0].items[0].runningText.some((segment) => segment.emphasis)).toBe(true)
  })

  it('summarizes adjacent execution skill groups by action and unique docx file count', () => {
    const readGroupId = 'run-1:skill:docx-reader'
    const writeGroupId = 'run-1:skill:docx-writer'
    const groups = [
      itemStarted({
        groupId: readGroupId,
        itemId: 'tool-outline',
        display: {
          kind: 'tool',
          toolName: 'docx_outline',
          input: { sourcePath: '/tmp/report.docx' }
        },
        createdAt: 1
      }),
      itemStarted({
        groupId: readGroupId,
        itemId: 'tool-read',
        display: {
          kind: 'tool',
          toolName: 'docx_read_blocks',
          input: {
            sourcePath: '/tmp/report.docx',
            range: { type: 'block_index', fromBlockIndex: 3, toBlockIndex: 8 }
          }
        },
        createdAt: 2
      }),
      itemStarted({
        groupId: writeGroupId,
        itemId: 'tool-edit',
        display: {
          kind: 'tool',
          toolName: 'docx_edit',
          input: { sourcePath: '/tmp/report.docx' }
        },
        createdAt: 3
      })
    ].reduce(reduceAssistantProcessGroups, [])

    expect(toText(buildAssistantExecutionSummaryText(groups))).toBe(
      '正在读取 1 个 docx 文件，正在编辑 1 个 docx 文件'
    )
    expect(buildAssistantExecutionSummaryText(groups).filter((segment) => segment.iconKind)).toHaveLength(2)
    expect(toText(groups[0].items[1].runningText)).toBe(
      '正在读取 /tmp/report.docx 文件的 3-8 区间'
    )
  })

  it('keeps a skill group running while any grouped tool item is still running', () => {
    const groupId = 'run-1:skill:docx-reader'
    const outlineDisplay = {
      kind: 'tool' as const,
      toolName: 'docx_outline',
      input: { sourcePath: '/tmp/report.docx' }
    }
    const readDisplay = {
      kind: 'tool' as const,
      toolName: 'docx_read_blocks',
      input: { sourcePath: '/tmp/report.docx' }
    }
    const groups = [
      groupStarted({ groupId, kind: 'skill', display: outlineDisplay }),
      itemStarted({ groupId, itemId: 'tool-outline', display: outlineDisplay, createdAt: 2 }),
      itemStarted({ groupId, itemId: 'tool-read', display: readDisplay, createdAt: 3 }),
      itemCompleted({ groupId, itemId: 'tool-outline', completedAt: 4 }),
      groupCompleted({ groupId, completedAt: 5 })
    ].reduce(reduceAssistantProcessGroups, [])

    expect(groups[0].status).toBe('running')
    expect(groups[0].items[0].status).toBe('completed')
    expect(groups[0].items[1].status).toBe('running')
  })

  it('keeps docx edit precise to the file and marks completion naturally', () => {
    const groupId = 'run-1:skill:docx-writer'
    const display = {
      kind: 'tool' as const,
      toolName: 'docx_edit',
      input: { sourcePath: '/tmp/draft.docx' }
    }
    const groups = [
      groupStarted({ groupId, kind: 'skill', display }),
      itemStarted({ groupId, itemId: 'tool-edit', display }),
      itemCompleted({ groupId, itemId: 'tool-edit' }),
      groupCompleted({ groupId })
    ].reduce(reduceAssistantProcessGroups, [])

    expect(toText(buildAssistantExecutionSummaryText(groups))).toBe('已编辑 1 个 docx 文件')
    expect(groups[0].status).toBe('completed')
    expect(toText(groups[0].items[0].runningText)).toBe('正在编辑 /tmp/draft.docx 文件')
    expect(toText(groups[0].items[0].completedText)).toBe('已编辑 /tmp/draft.docx 文件')
  })

  it('uses reference-reader text for search and does not expose internal tool names', () => {
    const event = groupStarted({
      groupId: 'run-1:skill:reference-reader',
      kind: 'skill',
      display: {
        kind: 'tool',
        toolName: 'kb_search',
        input: { query: '课程设计' }
      }
    })
    const groups = reduceAssistantProcessGroups([], event)
    const itemGroups = reduceAssistantProcessGroups(
      groups,
      itemStarted({
        groupId: 'run-1:skill:reference-reader',
        itemId: 'tool-search',
        display: {
          kind: 'tool',
          toolName: 'kb_search',
          input: { query: '课程设计' }
        }
      })
    )

    expect(buildAssistantProcessText(event)).toBe('俺正在查阅资料')
    expect(toText(buildAssistantExecutionSummaryText(itemGroups))).toBe('正在检索知识库')
    expect(toText(itemGroups[0].items[0].runningText)).toBe('正在搜索 课程设计')
    expect(toText(itemGroups[0].items[0].runningText)).not.toContain('kb_search')
  })

  it('keeps learning running until assistant_process_group_completed arrives', () => {
    const started = groupStarted({
      groupId: 'run-1:learning:docx-read',
      kind: 'learning',
      display: { kind: 'learning', skillId: 'docx-read' }
    })
    const runningGroups = reduceAssistantProcessGroups([], started)
    const completedGroups = reduceAssistantProcessGroups(
      runningGroups,
      groupCompleted({
        groupId: 'run-1:learning:docx-read',
        display: { kind: 'learning', skillId: 'docx-read' }
      })
    )

    expect(toText(runningGroups[0].runningText)).toBe('正在学习 docx 阅读器')
    expect(runningGroups[0].status).toBe('running')
    expect(toText(completedGroups[0].completedText)).toBe('已学会 docx 阅读器')
    expect(completedGroups[0].status).toBe('completed')
  })

  it('maps context compaction protocol to dedicated groups', () => {
    const compactionGroups = [
      groupStarted({
        groupId: 'run-1:compaction',
        kind: 'compaction',
        display: { kind: 'compaction' }
      }),
      groupCompleted({
        groupId: 'run-1:compaction',
        display: { kind: 'compaction' }
      })
    ].reduce(reduceAssistantProcessGroups, [])

    expect(toText(compactionGroups[0].runningText)).toBe('东西太多了，让俺整理下')
    expect(toText(compactionGroups[0].completedText)).toBe('呼，终于整理好了，累死俺了')
  })

  it('hides finalizing when final answer starts', () => {
    const groups = reduceAssistantProcessGroups(
      [],
      groupStarted({
        groupId: 'run-1:finalizing',
        kind: 'finalizing',
        display: { kind: 'finalizing' }
      })
    )

    expect(toText(groups[0].runningText)).toBe('基本完成了，让俺收尾下吧')
    expect(completeAssistantProcessGroups(groups)).toEqual([])
  })

  it('does not add legacy mouth events to process groups', () => {
    const mouth: AiRunEvent = {
      type: 'human_step',
      runId: 'run-1',
      taskId: 'task-1',
      stepIndex: 2,
      action: 'deliver_result',
      publicNarrative: '准备回答',
      learnedSkillIds: [],
      effectiveSkillIds: [],
      availableToolNames: [],
      summary: '',
      createdAt: 1
    }

    expect(reduceAssistantProcessGroups([], mouth)).toEqual([])
  })

  it('creates search-mode placeholder as reference reader', () => {
    const group = createSearchProcessGroup('assistant-search')

    expect(toText(group.runningText)).toBe('俺正在查阅资料')
    expect(group.skillKey).toBe('reference-reader')
  })
})

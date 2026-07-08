import { describe, expect, it } from 'vitest'
import type { WorkspaceSource } from '../../../../src/shared/types'
import {
  buildAssistantExecutionSummaryText,
  createAssistantThinkingGroup,
  getAttachmentTypeLabel,
  reduceAssistantProcessGroups,
  resolveAssistantExecutionStatus,
  resolveWorkbenchWorkspaceSelection
} from '../../../../src/renderer/src/components/workbench/utils'
import type {
  AssistantProcessGroup,
  AssistantProcessSkillKey,
  AssistantProcessStatus
} from '../../../../src/renderer/src/components/workbench/types'

const WORKSPACES: WorkspaceSource[] = [
  {
    id: 'workspace-first',
    name: '第一个工作空间',
    root_path: '/tmp/workspace-first',
    created_at: 1,
    updated_at: 1
  },
  {
    id: 'workspace-second',
    name: '第二个工作空间',
    root_path: '/tmp/workspace-second',
    created_at: 2,
    updated_at: 2
  }
]

const createProcessGroup = (
  id: string,
  skillKey: AssistantProcessSkillKey,
  status: AssistantProcessStatus
): AssistantProcessGroup => ({
  id,
  kind: 'skill',
  skillKey,
  iconKind: 'search',
  status,
  runningText: [{ text: `${id}-running` }],
  completedText: [{ text: `${id}-completed` }],
  failedText: [{ text: `${id}-failed` }],
  partialFailedText: [{ text: `${id}-partial` }],
  items: [
    {
      id: `${id}-item`,
      status,
      runningText: [{ text: `${id}-item-running` }],
      completedText: [{ text: `${id}-item-completed` }],
      failedText: [{ text: `${id}-item-failed` }],
      partialFailedText: [{ text: `${id}-item-partial` }],
      createdAt: 1,
      sourceEventType: 'assistant_process_item_started'
    }
  ],
  createdAt: 1,
  sourceEventType: 'assistant_process_group_started'
})

describe('workbench utils', () => {
  it('keeps workspace unselected when there is no valid user preference', () => {
    expect(resolveWorkbenchWorkspaceSelection(WORKSPACES, null)).toBeNull()
    expect(resolveWorkbenchWorkspaceSelection(WORKSPACES, 'missing-workspace')).toBeNull()
  })

  it('restores an existing preferred workspace', () => {
    expect(resolveWorkbenchWorkspaceSelection(WORKSPACES, 'workspace-second')).toBe(
      'workspace-second'
    )
  })

  it('removes stale thinking when a brain thought arrives', () => {
    const groups = reduceAssistantProcessGroups([createAssistantThinkingGroup('message-1')], {
      type: 'assistant_process_thought',
      runId: 'run-1',
      thoughtId: 'thought-1',
      text: '已经想好了',
      createdAt: 2
    })

    expect(groups.some((group) => group.kind === 'thinking')).toBe(false)
  })

  it('formats attachment type labels from file extensions', () => {
    expect(getAttachmentTypeLabel('report.pdf')).toBe('PDF')
    expect(getAttachmentTypeLabel('slides.Final.Pptx')).toBe('PPTX')
    expect(getAttachmentTypeLabel('README')).toBe('FILE')
    expect(getAttachmentTypeLabel('folder/note.md')).toBe('MD')
    expect(getAttachmentTypeLabel('folder/file.')).toBe('FILE')
  })

  it('marks execution as partial_failed when only some groups fail', () => {
    const groups = [
      createProcessGroup('search', 'web-search', 'completed'),
      createProcessGroup('crawl', 'web-crawl', 'failed')
    ]

    expect(resolveAssistantExecutionStatus(groups)).toBe('partial_failed')
  })

  it('separates web search and web crawl summary text', () => {
    const groups = [
      createProcessGroup('search', 'web-search', 'completed'),
      createProcessGroup('crawl', 'web-crawl', 'failed')
    ]

    expect(buildAssistantExecutionSummaryText(groups).map((item) => item.text).join('')).toBe(
      '已搜索网页，读取网页失败'
    )
  })

  it('uses partial failure text when the same web tool type has mixed results', () => {
    const groups = [
      createProcessGroup('crawl-ok', 'web-crawl', 'completed'),
      createProcessGroup('crawl-failed', 'web-crawl', 'failed')
    ]

    expect(resolveAssistantExecutionStatus(groups)).toBe('partial_failed')
    expect(buildAssistantExecutionSummaryText(groups).map((item) => item.text).join('')).toBe(
      '部分网页读取失败'
    )
  })
})

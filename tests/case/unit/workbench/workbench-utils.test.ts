import { describe, expect, it } from 'vitest'
import type { WorkspaceSource } from '../../../../src/shared/types'
import {
  createAssistantThinkingGroup,
  getAttachmentTypeLabel,
  reduceAssistantProcessGroups,
  resolveWorkbenchWorkspaceSelection
} from '../../../../src/renderer/src/components/workbench/utils'

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
})

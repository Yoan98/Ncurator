import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import {
  buildAssistantExecutionSummaryText,
  reduceAssistantProcessGroups,
  resolveAssistantExecutionIcon,
  shouldShowAssistantApplyTargets
} from '../../../../src/renderer/src/components/workbench/utils'

const reduceTool = (toolName: string, input: Record<string, string>) => {
  const display = { kind: 'tool' as const, toolName, input }
  const events: AiRunEvent[] = [
    {
      type: 'assistant_process_group_started',
      runId: 'run-1',
      groupId: `group-${toolName}`,
      kind: 'skill',
      display,
      createdAt: 1
    },
    {
      type: 'assistant_process_item_started',
      runId: 'run-1',
      groupId: `group-${toolName}`,
      itemId: `item-${toolName}`,
      display,
      createdAt: 2
    },
    {
      type: 'assistant_process_item_completed',
      runId: 'run-1',
      groupId: `group-${toolName}`,
      itemId: `item-${toolName}`,
      display,
      completedAt: 3
    }
  ]
  return events.reduce(reduceAssistantProcessGroups, [])
}

const itemText = (toolName: string, input: Record<string, string>) =>
  reduceTool(toolName, input)[0]
    ?.items[0]?.completedText.map((segment) => segment.text)
    .join('') || ''

describe('workbench assistant process copy', () => {
  it('separates file read and write wording and icons', () => {
    const read = reduceTool('file_read', { sourcePath: '/tmp/readme.md' })[0]
    const write = reduceTool('file_edit', { sourcePath: '/tmp/readme.md' })[0]
    expect(read?.iconKind).toBe('document')
    expect(write?.iconKind).toBe('edit')
    expect(read?.completedText.map((segment) => segment.text).join('')).toBe('已读取 1 个文件')
    expect(write?.completedText.map((segment) => segment.text).join('')).toBe('已编辑 1 个文件')
    expect(itemText('file_read', { sourcePath: '/tmp/readme.md' })).toContain(
      '读取文件 /tmp/readme.md'
    )
    expect(itemText('file_edit', { sourcePath: '/tmp/readme.md' })).toContain(
      '编辑文件 /tmp/readme.md'
    )
    expect(itemText('file_read', { sourcePath: '/tmp/readme.md' })).not.toContain('文本文件')
  })

  it('writes browser actions as complete natural-language sentences', () => {
    expect(itemText('browser_use', { action: 'observe', instruction: '检查所有按钮' })).toBe(
      '查看页面并检查所有按钮'
    )
    expect(itemText('browser_use', { action: 'extract', instruction: '读取结果区域' })).toBe(
      '从页面中读取结果区域'
    )
    expect(itemText('browser_use', { action: 'act', instruction: '点击提交按钮' })).toBe(
      '在页面上点击提交按钮'
    )
    expect(itemText('browser_use', { action: 'navigate', url: 'https://example.com' })).toContain(
      '打开网页 https://example.com'
    )
  })

  it('combines browser actions and waits into one sentence with one mixed-tool icon', () => {
    const groups = [
      ...reduceTool('browser_use', { action: 'navigate', url: 'https://example.com' }),
      ...reduceTool('browser_use', { action: 'act', instruction: '点击提交按钮' }),
      ...reduceTool('wait_time', { seconds: '1' })
    ]

    expect(
      buildAssistantExecutionSummaryText(groups)
        .map((item) => item.text)
        .join('')
    ).toBe('已操作浏览器 2 次并等待 1 秒')
    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
  })

  it('shows apply targets only after the run reaches a terminal state', () => {
    expect(shouldShowAssistantApplyTargets({ runFinished: false, applyTargetCount: 1 })).toBe(false)
    expect(shouldShowAssistantApplyTargets({ runFinished: true, applyTargetCount: 1 })).toBe(true)
    expect(shouldShowAssistantApplyTargets({ runFinished: true, applyTargetCount: 0 })).toBe(false)
  })
})

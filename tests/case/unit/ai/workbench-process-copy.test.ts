import { describe, expect, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import {
  reduceAssistantProcessGroups,
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
    const write = reduceTool('file_write', { sourcePath: '/tmp/readme.md' })[0]
    expect(read?.iconKind).toBe('document')
    expect(write?.iconKind).toBe('edit')
    expect(read?.completedText.map((segment) => segment.text).join('')).toBe('已读取 1 个文件')
    expect(write?.completedText.map((segment) => segment.text).join('')).toBe('已编辑 1 个文件')
    expect(itemText('file_read', { sourcePath: '/tmp/readme.md' })).toContain('读取文件：')
    expect(itemText('file_write', { sourcePath: '/tmp/readme.md' })).toContain('编辑文件：')
    expect(itemText('file_read', { sourcePath: '/tmp/readme.md' })).not.toContain('文本文件')
  })

  it('removes only observe, extract and act prefixes', () => {
    expect(itemText('browser_use', { action: 'observe', instruction: '检查所有按钮' })).toBe(
      '检查所有按钮'
    )
    expect(itemText('browser_use', { action: 'extract', instruction: '读取结果区域' })).toBe(
      '读取结果区域'
    )
    expect(itemText('browser_use', { action: 'act', instruction: '点击提交按钮' })).toBe(
      '点击提交按钮'
    )
    expect(itemText('browser_use', { action: 'navigate', url: 'https://example.com' })).toContain(
      '打开网页：'
    )
  })

  it('shows apply targets only after the run reaches a terminal state', () => {
    expect(shouldShowAssistantApplyTargets({ runFinished: false, applyTargetCount: 1 })).toBe(false)
    expect(shouldShowAssistantApplyTargets({ runFinished: true, applyTargetCount: 1 })).toBe(true)
    expect(shouldShowAssistantApplyTargets({ runFinished: true, applyTargetCount: 0 })).toBe(false)
  })
})

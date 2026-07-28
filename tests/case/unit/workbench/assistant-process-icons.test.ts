import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon
} from '../../../../src/renderer/src/components/workbench/utils'
import type { AssistantProcessGroup } from '../../../../src/renderer/src/components/workbench/types'

const toPlainText = (segments: ReturnType<typeof buildAssistantExecutionSummaryText>): string =>
  segments.map((segment) => segment.text).join('')

const createToolGroup = (toolName: AssistantProcessGroup['items'][number]['toolName'], index = 1) =>
  [
    {
      id: `group-${toolName}`,
      kind: 'skill',
      skillKey: 'generic',
      iconKind: 'default',
      status: 'completed',
      runningText: [],
      completedText: [],
      failedText: [],
      partialFailedText: [],
      createdAt: 1,
      sourceEventType: 'assistant_process_group_completed',
      items: [
        {
          id: `item-${toolName}-${String(index)}`,
          status: 'completed',
          runningText: [],
          completedText: [],
          failedText: [],
          partialFailedText: [],
          createdAt: index,
          sourceEventType: 'assistant_process_item_completed',
          toolName,
          targetLabel: `file-${String(index)}`
        }
      ]
    }
  ] satisfies AssistantProcessGroup[]

const createToolGroups = (
  toolNames: AssistantProcessGroup['items'][number]['toolName'][]
): AssistantProcessGroup[] =>
  toolNames.flatMap((toolName, index) => createToolGroup(toolName, index + 1))

describe('workbench assistant process icons', () => {
  it('uses action icons for file read, search, and edit steps', () => {
    expect(resolveAssistantExecutionIcon(createToolGroup('docx_read_outline'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('docx_edit'))).toBe('edit')
    expect(resolveAssistantExecutionIcon(createToolGroup('excel_read_outline'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('excel_edit'))).toBe('edit')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_read_outline'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_search'))).toBe('search')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_edit'))).toBe('edit')
  })

  it('uses workflow icon and a concise sentence for mixed tool summaries', () => {
    const groups = createToolGroups(['excel_read_outline', 'excel_edit'])

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe(
      '已读取 1 个 Excel 文件并已编辑 1 个 Excel 文件'
    )
  })

  it('summarizes more than three tool kinds with action labels', () => {
    const groups = createToolGroups([
      'excel_read_outline',
      'web_search',
      'excel_edit',
      'terminal_run'
    ])

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe(
      '已完成 4 项操作：读取、搜索、编辑等'
    )
  })
})

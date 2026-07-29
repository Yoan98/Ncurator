import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  type AssistantExecutionGroup
} from '../../../../src/shared/assistantExecutionSummary'

const toPlainText = (segments: ReturnType<typeof buildAssistantExecutionSummaryText>): string =>
  segments.map((segment) => segment.text).join('')

type ToolName = NonNullable<AssistantExecutionGroup['items'][number]['toolName']>

const createToolGroup = (toolName: ToolName, index = 1): AssistantExecutionGroup[] => [
  {
    id: `group-${toolName}`,
    skillKey: 'generic',
    status: 'completed',
    items: [
      {
        toolName,
        targetLabel: `file-${String(index)}`
      }
    ]
  }
]

const createToolGroups = (toolNames: ToolName[]): AssistantExecutionGroup[] =>
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

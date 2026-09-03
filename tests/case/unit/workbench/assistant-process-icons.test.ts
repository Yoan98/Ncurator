import { describe, expect, it } from 'vitest'
import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  type AssistantExecutionGroup
} from '../../../../src/shared/assistantExecutionSummary'

const toPlainText = (segments: ReturnType<typeof buildAssistantExecutionSummaryText>): string =>
  segments.map((segment) => segment.text).join('')

type ToolName = NonNullable<AssistantExecutionGroup['items'][number]['toolName']>

const createToolGroup = (
  toolName: ToolName,
  index = 1,
  options?: {
    status?: AssistantExecutionGroup['status']
    completedText?: string
    runningText?: string
    failedText?: string
  }
): AssistantExecutionGroup[] => [
  {
    id: `${toolName}-${index}`,
    skillKey: 'generic',
    status: options?.status || 'completed',
    items: [
      {
        toolName,
        status: options?.status || 'completed',
        targetLabel: `${toolName}-${index}`,
        completedText: options?.completedText
          ? [{ text: options.completedText }]
          : [{ text: `已完成 ${toolName}` }],
        runningText: options?.runningText
          ? [{ text: options.runningText }]
          : [{ text: `正在执行 ${toolName}` }],
        failedText: options?.failedText
          ? [{ text: options.failedText }]
          : [{ text: `${toolName} 失败` }]
      }
    ]
  }
]

const createToolGroups = (toolNames: ToolName[]): AssistantExecutionGroup[] =>
  toolNames.flatMap((toolName, index) => createToolGroup(toolName, index + 1))

describe('assistant process icons and activity summary', () => {
  it('uses semantic icons for single-tool activities', () => {
    expect(resolveAssistantExecutionIcon(createToolGroup('docx_read_outline'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('docx_content_edit'))).toBe('edit')
    expect(resolveAssistantExecutionIcon(createToolGroup('excel_read'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('excel_edit'))).toBe('edit')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_read_outline'))).toBe('document')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_search'))).toBe('search')
    expect(resolveAssistantExecutionIcon(createToolGroup('ppt_edit'))).toBe('edit')
    expect(resolveAssistantExecutionIcon(createToolGroup('learn_skill'))).toBe('learning')
  })

  it('uses short skill summary for same-skill activity headers without tool args', () => {
    const groups = createToolGroups(['terminal_run', 'terminal_run', 'terminal_read'])

    expect(resolveAssistantExecutionIcon(groups)).toBe('terminal')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已执行终端指令')
  })

  it('summarizes mixed skills as count-only operations', () => {
    const groups = [
      ...createToolGroup('learn_skill', 1, { completedText: '已学会 docx 阅读器' }),
      ...createToolGroup('docx_read_outline', 2, {
        completedText: '查看 Word 文档 合同.docx 的结构'
      })
    ]

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已完成 2 项操作')
  })

  it('summarizes more than three tools as n operations without action-class suffix', () => {
    const groups = createToolGroups([
      'excel_read',
      'web_search',
      'excel_edit',
      'terminal_run'
    ])

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已完成 4 项操作')
  })

  it('keeps single-tool header short even when body text has args', () => {
    const groups = createToolGroup('terminal_run', 1, {
      completedText: '执行命令 find /tmp -name "*.docx"'
    })
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已执行终端指令')
  })
})

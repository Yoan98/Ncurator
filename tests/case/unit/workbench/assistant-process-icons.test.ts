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

  it('joins up to three tool item texts with 并/但', () => {
    const groups = [
      ...createToolGroup('learn_skill', 1, { completedText: '已学会 docx 阅读器' }),
      ...createToolGroup('docx_read_outline', 2, {
        completedText: '查看 Word 文档 合同.docx 的结构'
      })
    ]

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe(
      '已学会 docx 阅读器并查看 Word 文档 合同.docx 的结构'
    )
  })

  it('uses but connector when a later item failed', () => {
    const groups = [
      ...createToolGroup('web_search', 1, { completedText: '搜索网页 React' }),
      ...createToolGroup('text_file_read', 2, {
        status: 'failed',
        failedText: '读取文件 notes.md 失败了'
      })
    ]
    groups[1] = { ...groups[1], status: 'failed' }

    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe(
      '搜索网页 React但读取文件 notes.md 失败了'
    )
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
})

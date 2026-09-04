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
    completedText?: Array<{ text: string; param?: boolean }>
    runningText?: Array<{ text: string; param?: boolean }>
    failedText?: Array<{ text: string; param?: boolean }>
    headerShortText?: string
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
        completedText: options?.completedText || [{ text: `已完成 ${toolName}` }],
        runningText: options?.runningText || [{ text: `正在执行 ${toolName}` }],
        failedText: options?.failedText || [{ text: `${toolName} 失败` }],
        headerShortText: options?.headerShortText
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

  it('joins up to three tool short texts with 并/但 and drops param segments', () => {
    const groups = [
      ...createToolGroup('learn_skill', 1, {
        completedText: [{ text: '已学会 ' }, { text: 'docx 阅读器' }],
        headerShortText: '已学会 docx 阅读器'
      }),
      ...createToolGroup('terminal_run', 2, {
        completedText: [{ text: '执行命令 ' }, { text: 'find /tmp -name "*.docx"', param: true }],
        headerShortText: '执行命令'
      })
    ]

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe(
      '已学会 docx 阅读器 并 执行命令'
    )
  })

  it('uses but connector when a later item failed', () => {
    const groups = [
      ...createToolGroup('web_search', 1, {
        completedText: [{ text: '搜索网页 ' }, { text: 'React', param: true }],
        headerShortText: '搜索网页'
      }),
      ...createToolGroup('text_file_read', 2, {
        status: 'failed',
        failedText: [{ text: '读取文件 ' }, { text: 'notes.md', param: true }],
        headerShortText: '读取文件'
      })
    ]
    groups[1] = { ...groups[1], status: 'failed' }

    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('搜索网页 但 读取文件')
  })

  it('merges same tool kind with count instead of repeating short text', () => {
    const groups = [
      ...createToolGroup('web_search', 1, {
        completedText: [{ text: '搜索网页 ' }, { text: 'a', param: true }],
        headerShortText: '搜索网页'
      }),
      ...createToolGroup('web_search', 2, {
        completedText: [{ text: '搜索网页 ' }, { text: 'b', param: true }],
        headerShortText: '搜索网页'
      })
    ]
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('搜索网页 2 次')
  })

  it('collapses more than three kinds into completed count', () => {
    const groups = createToolGroups([
      'learn_skill',
      'web_search',
      'terminal_run',
      'text_file_read'
    ])
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已完成 4 项')
  })

  it('keeps single-tool header as action short text without args', () => {
    const groups = createToolGroup('terminal_run', 1, {
      completedText: [
        { text: '执行命令 ' },
        { text: 'find /tmp -name "*.docx"', param: true }
      ],
      headerShortText: '执行命令'
    })
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('执行命令')
  })

  it('uses explicit headerShortText for browser actions in activity summary', () => {
    expect(
      toPlainText(
        buildAssistantExecutionSummaryText([
          {
            id: 'browser-observe',
            skillKey: 'browser',
            status: 'completed',
            items: [
              {
                toolName: 'browser_use',
                status: 'completed',
                completedText: [{ text: '查看页面并找到登录入口' }],
                headerShortText: '查看页面'
              }
            ]
          }
        ])
      )
    ).toBe('查看页面')
  })

  it('keeps docx outline header standalone when file param is omitted', () => {
    expect(
      toPlainText(
        buildAssistantExecutionSummaryText([
          {
            id: 'docx-outline',
            skillKey: 'docx-read',
            status: 'completed',
            items: [
              {
                toolName: 'docx_read_outline',
                status: 'completed',
                completedText: [
                  { text: '查看 Word 文档 ' },
                  { text: 'report.docx', param: true },
                  { text: ' 的结构' }
                ],
                headerShortText: '查看 Word 文档结构'
              }
            ]
          }
        ])
      )
    ).toBe('查看 Word 文档结构')
  })
})

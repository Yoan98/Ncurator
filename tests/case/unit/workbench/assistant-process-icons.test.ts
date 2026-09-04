import { describe, expect, it } from 'vitest'
import {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  type AssistantExecutionGroup
} from '../../../../src/shared/assistantExecutionSummary'
import { createDisplayProcessItem } from '../../../../src/renderer/src/components/workbench/utils'

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
      }),
      ...createToolGroup('web_search', 3, {
        completedText: [{ text: '搜索网页 ' }, { text: 'c', param: true }],
        headerShortText: '搜索网页'
      })
    ]
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('搜索网页 3 次')
  })

  it('summarizes more than three merged kinds as 已完成 n 项', () => {
    const groups = createToolGroups([
      'excel_read',
      'web_search',
      'excel_edit',
      'terminal_run'
    ])

    expect(resolveAssistantExecutionIcon(groups)).toBe('workflow')
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('已完成 4 项')
  })

  it('keeps count form as 已完成 n 项 even while some tools are still running', () => {
    const groups = createToolGroups([
      'excel_read',
      'web_search',
      'excel_edit',
      'terminal_run'
    ]).map((group, index) =>
      index === 3
        ? {
            ...group,
            status: 'running' as const,
            items: group.items.map((item) => ({ ...item, status: 'running' as const }))
          }
        : group
    )
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

  it('uses explicit headerShortText for browser actions instead of truncated expand prefixes', () => {
    const observe = createDisplayProcessItem({
      itemId: 'observe-1',
      display: {
        kind: 'tool',
        toolName: 'browser_use',
        input: { action: 'observe', instruction: '找到登录入口' }
      },
      status: 'completed',
      createdAt: 1,
      sourceEventType: 'assistant_process_item_completed'
    })
    const extract = createDisplayProcessItem({
      itemId: 'extract-1',
      display: {
        kind: 'tool',
        toolName: 'browser_use',
        input: { action: 'extract', instruction: '提取登录表单' }
      },
      status: 'completed',
      createdAt: 2,
      sourceEventType: 'assistant_process_item_completed'
    })
    const act = createDisplayProcessItem({
      itemId: 'act-1',
      display: {
        kind: 'tool',
        toolName: 'browser_use',
        input: { action: 'act', instruction: '点击登录' }
      },
      status: 'completed',
      createdAt: 3,
      sourceEventType: 'assistant_process_item_completed'
    })

    expect(observe.headerShortText).toBe('查看页面')
    expect(toPlainText(observe.completedText)).toBe('查看页面并找到登录入口')
    expect(extract.headerShortText).toBe('提取内容')
    expect(toPlainText(extract.completedText)).toBe('从页面中提取登录表单')
    expect(act.headerShortText).toBe('操作页面')
    expect(toPlainText(act.completedText)).toBe('在页面上点击登录')

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
                completedText: observe.completedText,
                headerShortText: observe.headerShortText
              }
            ]
          }
        ])
      )
    ).toBe('查看页面')
  })

  it('keeps docx outline header standalone when file param is omitted', () => {
    const item = createDisplayProcessItem({
      itemId: 'outline-1',
      display: {
        kind: 'tool',
        toolName: 'docx_read_outline',
        input: { fileName: 'report.docx' }
      },
      status: 'completed',
      createdAt: 1,
      sourceEventType: 'assistant_process_item_completed'
    })
    expect(item.headerShortText).toBe('查看 Word 文档结构')
    expect(toPlainText(item.completedText)).toBe('查看 Word 文档 report.docx 的结构')
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
                completedText: item.completedText,
                headerShortText: item.headerShortText
              }
            ]
          }
        ])
      )
    ).toBe('查看 Word 文档结构')
  })
})

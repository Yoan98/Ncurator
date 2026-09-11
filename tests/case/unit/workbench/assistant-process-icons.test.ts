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
    input?: Record<string, unknown>
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
        headerShortText: options?.headerShortText,
        input: options?.input as any
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

  it('joins up to three tool short texts with commas and drops param segments', () => {
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
      '已学会 docx 阅读器,执行命令'
    )
  })

  it('joins failed later items with commas like other kinds', () => {
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

    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('搜索网页,读取文件')
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

  it('resolves semantic icons for browser and web actions', () => {
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'navigate' }, headerShortText: '打开网页' })
      )
    ).toBe('web')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'observe' }, headerShortText: '查看页面' })
      )
    ).toBe('eye')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'act' }, headerShortText: '操作页面' })
      )
    ).toBe('browser')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'extract' }, headerShortText: '提取内容' })
      )
    ).toBe('extract')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'screenshot' }, headerShortText: '截取页面' })
      )
    ).toBe('camera')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'scroll' }, headerShortText: '滚动页面' })
      )
    ).toBe('scroll')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('browser_use', 1, { input: { action: 'list_tabs' }, headerShortText: '列出标签' })
      )
    ).toBe('window')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('web_search', 1, { input: { type: 'fetch' }, headerShortText: '抓取网页' })
      )
    ).toBe('fetch')
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('web_search', 1, { input: { type: 'search' }, headerShortText: '搜索网页' })
      )
    ).toBe('search')
  })

  it('merges identical browser actions and keeps their semantic icon', () => {
    const groups = [
      ...createToolGroup('browser_use', 1, {
        input: { action: 'observe' },
        headerShortText: '查看页面'
      }),
      ...createToolGroup('browser_use', 2, {
        input: { action: 'observe' },
        headerShortText: '查看页面'
      })
    ]
    expect(toPlainText(buildAssistantExecutionSummaryText(groups))).toBe('查看页面 2 次')
    expect(resolveAssistantExecutionIcon(groups)).toBe('eye')
  })

  it('joins heterogeneous tool actions with commas and resolves to workflow icon', () => {
    const cases = [
      {
        groups: [
          ...createToolGroup('browser_use', 1, {
            input: { action: 'navigate' },
            headerShortText: '打开网页'
          }),
          ...createToolGroup('browser_use', 2, {
            input: { action: 'observe' },
            headerShortText: '查看页面'
          })
        ],
        expectedText: '打开网页,查看页面'
      },
      {
        groups: [
          ...createToolGroup('web_search', 1, {
            input: { type: 'search' },
            headerShortText: '搜索网页'
          }),
          ...createToolGroup('web_search', 2, {
            input: { type: 'fetch' },
            headerShortText: '抓取网页'
          })
        ],
        expectedText: '搜索网页,抓取网页'
      }
    ]

    for (const testCase of cases) {
      expect(toPlainText(buildAssistantExecutionSummaryText(testCase.groups))).toBe(
        testCase.expectedText
      )
      expect(resolveAssistantExecutionIcon(testCase.groups)).toBe('workflow')
    }
  })

  it('resolves image icon for read_image standalone and screenshot paired with read_image', () => {
    expect(
      resolveAssistantExecutionIcon(
        createToolGroup('read_image', 1, { headerShortText: '读取图片' })
      )
    ).toBe('image')

    const screenshotAndRead = [
      ...createToolGroup('browser_use', 1, {
        input: { action: 'screenshot' },
        headerShortText: '截取页面'
      }),
      ...createToolGroup('read_image', 2, {
        headerShortText: '读取图片'
      })
    ]
    expect(toPlainText(buildAssistantExecutionSummaryText(screenshotAndRead))).toBe(
      '截取页面,读取图片'
    )
    expect(resolveAssistantExecutionIcon(screenshotAndRead)).toBe('image')
  })
})

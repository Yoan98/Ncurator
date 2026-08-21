import { describe, expect, it } from 'vitest'
import { renderTodoItems } from '../../../../src/main/services/ai/human/shared/memoryRenderers'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  appendRoundRecord,
  buildHandExecution
} from '../../../../src/main/services/ai/human/memory/rounds'
import { renderBrainRoundSection } from '../../../../src/main/services/ai/human/shared/historyRenderers'

describe('ai unit human memory renderers', () => {
  it('renders todolist items as the current action path', () => {
    const items = [
      {
        item: '核对工作区文件',
        status: 'todo'
      }
    ]

    const text = renderTodoItems(items)

    expect(text).toBe('- [todo] 核对工作区文件')
  })

  it('renders empty todolist as empty string', () => {
    expect(renderTodoItems([])).toBe('')
  })

  it('renders the todo items before the progress overview inside a round', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-round-todolist',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '先核对工作区文件',
        todolist: [
          { item: '核对工作区文件', status: 'done' },
          { item: '检查是否满足用户诉求', status: 'todo' }
        ],
        progressOverview: '- 已经尝试过什么：读取目录\n- 形成了什么结论：缺少发布说明\n- 证据是什么：release-note.txt'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt',
              commandExplanation: '读取发布状态文件。'
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt',
              commandExplanation: '读取发布状态文件。'
            }
          }
        ],
        toolResults: [
          {
            toolName: 'terminal_run',
            ok: true,
            data: {
              terminalId: 'term-1',
              commandId: 'command-1',
              terminalStatus: 'idle',
              executionStatus: 'completed',
              currentTerminalPath: '/tmp/workspace',
              output: 'latest release status',
              outputCursor: 21,
              exitCode: 0
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('代办事项：')
    expect(rendered).toContain('- [done] 核对工作区文件')
    expect(rendered).toContain('- [todo] 检查是否满足用户诉求')
    expect(rendered).toContain('当前整体推进进展：')
    expect(rendered.indexOf('代办事项：')).toBeLessThan(rendered.indexOf('当前整体推进进展：'))
  })

  it('renders the overall progress overview below the round execution', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-round-progress-overview',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '先读取 release-note.txt 确认最新状态',
        progressOverview: '- 已经尝试过什么：读取目录\n- 形成了什么结论：缺少发布说明\n- 证据是什么：release-note.txt'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt',
              commandExplanation: '读取发布状态文件。'
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt',
              commandExplanation: '读取发布状态文件。'
            }
          }
        ],
        toolResults: [
          {
            toolName: 'terminal_run',
            ok: true,
            data: {
              terminalId: 'term-1',
              commandId: 'command-1',
              terminalStatus: 'idle',
              executionStatus: 'completed',
              currentTerminalPath: '/tmp/workspace',
              output: 'latest release status',
              outputCursor: 21,
              exitCode: 0
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('- 第 1 轮\n判断：')
    expect(rendered).toContain('先读取 release-note.txt 确认最新状态')
    expect(rendered).toContain('执行：')
    expect(rendered).toContain('类型：hand')
    expect(rendered).toContain('当前整体推进进展：')
    expect(rendered).toContain('已经尝试过什么：读取目录')
    expect(rendered.indexOf('类型：hand')).toBeLessThan(rendered.indexOf('当前整体推进进展：'))
  })

  it('renders history tool results with boolean-tree filtered compact json', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-whitelist',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '读取文档块并保留必要字段'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: 'draft.docx',
              actions: [
                {
                  type: 'insert_blocks',
                  blocks: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'run', children: [{ type: 'text', text: '...' }] }]
                    }
                  ]
                }
              ]
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'docx_edit',
            args: {
              sourcePath: 'draft.docx',
              actions: [
                {
                  type: 'insert_blocks',
                  blocks: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'run', children: [{ type: 'text', text: '...' }] }]
                    }
                  ]
                }
              ]
            }
          }
        ],
        toolResults: [
          {
            toolName: 'docx_edit',
            ok: true,
            data: {
              sourcePath: 'draft.docx',
              previousRevisionRef: 'rev-1',
              currentRevisionRef: 'rev-2',
              createdBlocks: [{ blockId: 'b:0', type: 'paragraph' }],
              ignoredTopLevelField: 'drop-me',
              postWriteReadback: {
                ignoredObjectField: 'drop-me',
                regions: [
                  {
                    fromBlockIndex: 1,
                    toBlockIndex: 2,
                    ignoredRegionField: 'drop-me',
                    blocks: [
                      {
                        blockId: 'b1',
                        type: 'paragraph',
                        blockIndex: 1,
                        text: 'hello',
                        ignoredBlockField: 'drop-me'
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('第 1 轮')
    expect(rendered).toContain('- 第 1 轮\n判断：')
    expect(rendered).not.toContain('- 第 1 轮\n\n判断：')
    expect(rendered).not.toContain('\n\n执行：')
    expect(rendered).toContain(
      '参数：{"sourcePath":"draft.docx","actions":[{"type":"insert_blocks","blocks":[{"type":"paragraph","children":[{"type":"run","children":[{"type":"text","text":"..."}]}]}]}]}'
    )
    expect(rendered).toContain(
      '"postWriteReadback":{"regions":[{"fromBlockIndex":1,"toBlockIndex":2,"blocks":[{"blockId":"b1","type":"paragraph","blockIndex":1,"text":"hello"}]}]}'
    )
    expect(rendered).not.toContain('previousRevisionRef')
    expect(rendered).not.toContain('currentRevisionRef')
    expect(rendered).not.toContain('createdBlocks')
    expect(rendered).not.toContain('诊断：')
    expect(rendered).not.toContain('ignoredTopLevelField')
    expect(rendered).not.toContain('ignoredObjectField')
    expect(rendered).not.toContain('ignoredRegionField')
    expect(rendered).not.toContain('ignoredBlockField')
  })

  it('keeps text_file_read content in brain history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-file-read',
      userInput: '读取配置文件'
    })
    const call = {
      toolName: 'text_file_read',
      args: { sourcePath: 'config.ts' }
    }
    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '读取配置文件'
      },
      nextAction: { action: 'hand', calls: [call] },
      execution: buildHandExecution({
        calls: [call],
        toolResults: [
          {
            toolName: 'text_file_read',
            ok: true,
            data: {
              sourcePath: 'config.ts',
              content: 'const timeout = 1000',
              startLine: 1,
              endLine: 1,
              totalLines: 1
            }
          }
        ]
      })
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)
    expect(rendered).toContain('"content":"const timeout = 1000"')
    expect(rendered).toContain('"totalLines":1')
  })

  it('keeps PDF page text and visual reading results in brain history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-pdf',
      userInput: '阅读 PDF 图文'
    })
    const calls = [
      {
        toolName: 'pdf_read_pages',
        args: {
          sourcePath: '/workspace/深度学习.pdf',
          selection: { type: 'page_numbers', pageNumbers: [9] }
        }
      },
      {
        toolName: 'pdf_read_visuals',
        args: {
          sourcePath: '/workspace/深度学习.pdf',
          requests: [{ index: 9, instruction: '说明第 9 页图形结论。' }]
        }
      }
    ]
    const taskRun = appendRoundRecord({
      state: initialState,
      thought: { next: '读取 PDF 页面并渲染图片' },
      nextAction: { action: 'hand', calls },
      execution: buildHandExecution({
        calls,
        toolResults: [
          {
            toolName: 'pdf_read_pages',
            ok: true,
            data: {
              sourcePath: '/workspace/深度学习.pdf',
              pageCount: 11,
              pages: [
                {
                  pageNumber: 9,
                  text: '过度拟合会让训练与验证表现差距变大',
                  charCount: 19,
                  textStatus: 'available',
                  imageCount: 1
                }
              ]
            }
          },
          {
            toolName: 'pdf_read_visuals',
            ok: true,
            data: {
              sourcePath: '/workspace/深度学习.pdf',
              results: [{ index: 9, text: 'Overfit 图里训练和验证曲线差距明显。' }]
            }
          }
        ]
      })
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)
    expect(rendered).toContain('过度拟合会让训练与验证表现差距变大')
    expect(rendered).toContain('Overfit 图里训练和验证曲线差距明显')
    expect(rendered).toContain('"index":9')
  })

  it('keeps Excel read and edit results in brain history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-excel',
      userInput: '修改 Excel 数据'
    })
    const calls = [
      {
        toolName: 'excel_read_outline',
        args: { sourcePath: '/workspace/data.xlsx' }
      },
      {
        toolName: 'excel_edit',
        args: { sourcePath: '/workspace/data.xlsx', actions: [] }
      }
    ]
    const taskRun = appendRoundRecord({
      state: initialState,
      thought: { next: '读取并修改 Excel' },
      nextAction: { action: 'hand', calls },
      execution: buildHandExecution({
        calls,
        toolResults: [
          {
            toolName: 'excel_read_outline',
            ok: true,
            data: {
              sourcePath: '/workspace/data.xlsx',
              sheetCount: 1,
              sheets: [
                {
                  name: 'Data',
                  index: 0,
                  range: 'A1:D3',
                  rowCount: 3,
                  columnCount: 4,
                  formulaCount: 2,
                  tables: []
                }
              ]
            }
          },
          {
            toolName: 'excel_edit',
            ok: true,
            data: {
              sourcePath: '/workspace/data.xlsx',
              changed: true,
              changes: [{ sheetName: 'Data', address: 'B2', kind: 'modified' }],
              postWriteReadback: [
                {
                  sheetName: 'Data',
                  address: 'B2',
                  value: 20,
                  displayValue: '20',
                  type: 'number'
                }
              ],
              diffPath: '/workspace/.ncurator/data.diff.xlsx'
            }
          }
        ]
      })
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)
    expect(rendered).toContain('"sheetCount":1')
    expect(rendered).toContain('"name":"Data"')
    expect(rendered).toContain('"kind":"modified"')
    expect(rendered).toContain('"value":20')
    expect(rendered).not.toContain('返回：{}')
  })

  it('renders kb_list_documents result ids in round history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-kb-list-documents',
      userInput: '列出知识库文档'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '查看知识库可检索文档列表'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'kb_list_documents',
            args: {
              page: 1,
              pageSize: 20
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'kb_list_documents',
            args: {
              page: 1,
              pageSize: 20
            }
          }
        ],
        toolResults: [
          {
            toolName: 'kb_list_documents',
            ok: true,
            data: {
              items: [
                {
                  id: 'workspace-file-doc-1',
                  name: '图形学.docx',
                  file_path: '/tmp/workspace/学习笔记/图形学.docx'
                }
              ],
              total: 1
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('"id":"workspace-file-doc-1"')
    expect(rendered).toContain('"name":"图形学.docx"')
    expect(rendered).toContain('"total":1')
    expect(rendered).toContain('"file_path":"/tmp/workspace/学习笔记/图形学.docx"')
  })

  it('keeps ppt page count and slide text in round history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-ppt-overview',
      userInput: '创建两页 PPT'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: { next: '确认 PPT 页面内容' },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'ppt_read_outline',
            args: {
              sourcePath: '季度复盘.pptx',
              ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'ppt_read_outline',
            args: {
              sourcePath: '季度复盘.pptx',
              ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
            }
          }
        ],
        toolResults: [
          {
            toolName: 'ppt_read_outline',
            ok: true,
            data: {
              sourcePath: '季度复盘.pptx',
              slideCount: 2,
              slides: [
                {
                  slideId: '/ppt/slides/slide1.xml',
                  slideIndex: 1,
                  text: '增长引擎'
                },
                {
                  slideId: '/ppt/slides/slide2.xml',
                  slideIndex: 2,
                  text: '下一步行动'
                }
              ],
              internalDraftState: 'drop-me'
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('"slideCount":2')
    expect(rendered).toContain('"text":"增长引擎"')
    expect(rendered).toContain('"text":"下一步行动"')
    expect(rendered).not.toContain('internalDraftState')
  })

  it('renders unconfigured tool results with fallback minimal fields only', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-fallback',
      userInput: '继续推进'
    })

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        next: '执行未配置工具'
      },
      nextAction: {
        action: 'hand',
        calls: [
          {
            toolName: 'custom_tool',
            args: {
              value: 1
            }
          }
        ]
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'custom_tool',
            args: {
              value: 1
            }
          }
        ],
        toolResults: [
          {
            toolName: 'custom_tool',
            ok: false,
            data: {
              message: 'fallback message',
              error: 'fallback error',
              stdout: 'drop stdout',
              nested: {
                keep: false
              }
            }
          }
        ]
      }),
      createdAt: 1
    })

    const rendered = renderBrainRoundSection(taskRun.rounds)

    expect(rendered).toContain('"message":"fallback message","error":"fallback error"')
    expect(rendered).not.toContain('drop stdout')
    expect(rendered).not.toContain('"nested"')
  })
})

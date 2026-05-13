import { describe, expect, it } from 'vitest'
import { appendRoundRecord, buildHandExecution } from '../../../src/main/services/ai/human/memory/roundHistory'
import {
  renderBrainRoundSection,
  renderMouthHistoryText
} from '../../../src/main/services/ai/human/shared/historyRenderers'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'

describe('ai unit human history renderers', () => {
  it('renders brain history with raw diagnostic details', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-diagnostic',
      userInput: '继续修正 docx 参数'
    })
    const history = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          summary: '重试 docx_text_edit'
        },
        nextAction: {
          action: 'hand',
          toolUsePlan: {
            mode: 'serial',
            calls: [
              {
                toolName: 'docx_text_edit',
                args: {
                  sourcePath: 'weekly-risk.docx',
                  query: ''
                }
              }
            ]
          }
        }
      },
      execution: buildHandExecution({
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_text_edit',
              args: {
                sourcePath: 'weekly-risk.docx',
                query: ''
              }
            }
          ]
        },
        toolResults: [
          {
            toolName: 'docx_text_edit',
            ok: false,
            code: 'invalid_input',
            data: {
              ok: false,
              code: 'invalid_input',
              error: 'Received tool input did not match expected schema ✖ Invalid input → at query'
            },
            diagnostic: {
              message: 'Received tool input did not match expected schema ✖ Invalid input → at query'
            }
          }
        ]
      }),
      createdAt: 1
    })

    const text = renderBrainRoundSection(history.roundHistory)

    expect(text).toContain('调用参数：')
    expect(text).toContain('诊断：')
    expect(text).toContain('Received tool input did not match expected schema ✖ Invalid input → at query')
  })

  it('renders mouth history as factual results without replaying raw call args', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-3',
      userInput: '继续修正 docx 参数'
    })
    const history = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          summary: '重试 docx_text_edit'
        },
        nextAction: {
          action: 'hand',
          toolUsePlan: {
            mode: 'serial',
            calls: [
              {
                toolName: 'docx_text_edit',
                args: {
                  sourcePath: 'weekly-risk.docx',
                  query: ''
                }
              }
            ]
          }
        }
      },
      execution: buildHandExecution({
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_text_edit',
              args: {
                sourcePath: 'weekly-risk.docx',
                query: ''
              }
            }
          ]
        },
        toolResults: [
          {
            toolName: 'docx_text_edit',
            ok: false,
            code: 'invalid_input',
            data: {
              ok: false,
              code: 'invalid_input',
              error: 'Received tool input did not match expected schema ✖ Invalid input → at query'
            },
            diagnostic: {
              message: 'Received tool input did not match expected schema ✖ Invalid input → at query'
            }
          }
        ]
      }),
      createdAt: 1
    })

    const text = renderMouthHistoryText({
      roundHistory: history.roundHistory,
      compactBlocks: []
    })

    expect(text).toContain('已发生的关键结果：')
    expect(text).toContain('Received tool input did not match expected schema ✖ Invalid input → at query')
    expect(text).not.toContain('调用参数：')
  })

  it('renders docx read facts for mouth without low-level locator noise', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-docx-read',
      userInput: '按资料说明反走样处理方法'
    })
    const history = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          summary: '读取图形学区间'
        },
        nextAction: {
          action: 'hand',
          toolUsePlan: {
            mode: 'serial',
            calls: [
              {
                toolName: 'docx_read_blocks',
                args: {
                  sourcePath: 'graphics.docx',
                  fromBlockId: 'b:19',
                  toBlockId: 'b:26'
                }
              }
            ]
          }
        }
      },
      execution: buildHandExecution({
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_read_blocks',
              args: {
                sourcePath: 'graphics.docx',
                fromBlockId: 'b:19',
                toBlockId: 'b:26'
              }
            }
          ]
        },
        toolResults: [
          {
            toolName: 'docx_read_blocks',
            ok: true,
            code: 'ok',
            data: {
              ok: true,
              code: 'ok',
              sourcePath: 'graphics.docx',
              currentRevisionRef: 'v3',
              fromBlockId: 'b:19',
              toBlockId: 'b:26',
              returnedBlockCount: 2,
              blocks: [
                {
                  blockId: 'b:23',
                  type: 'paragraph',
                  bodyIndex: 23,
                  text: '通过模拟一个像素内多个像素点。'
                },
                {
                  blockId: 'b:25',
                  type: 'paragraph',
                  bodyIndex: 25,
                  text: '进行低通滤波，过滤掉高频信号，以达到反走样。'
                }
              ]
            }
          }
        ]
      }),
      createdAt: 2
    })

    const text = renderMouthHistoryText({
      roundHistory: history.roundHistory,
      compactBlocks: []
    })

    expect(text).toContain('多个像素点')
    expect(text).toContain('低通滤波')
    expect(text).not.toContain('fromBlockId')
  })

  it('renders actual docx write content for mouth result summarization', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-docx-write',
      userInput: '把主稿补充完整并插入表格'
    })
    const history = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          summary: '写入主稿段落和表格'
        },
        nextAction: {
          action: 'hand',
          toolUsePlan: {
            mode: 'serial',
            calls: [
              {
                toolName: 'docx_paragraph_edit',
                args: {
                  sourcePath: 'prd.docx',
                  action: 'replace_text',
                  blockId: 'b:31',
                  text: '每个探究环节应包含四个核心设计要素：探究目标、探究素材、学生活动设计、环节推进条件。'
                }
              },
              {
                toolName: 'docx_table_edit',
                args: {
                  sourcePath: 'prd.docx',
                  action: 'insert_after',
                  anchorBlockId: 'b:32',
                  rows: [
                    ['设计要素', '关键内容', '互动形式示例'],
                    ['探究目标', '明确学生需达成的认知目标', '情境引入、问题聚焦、概念生成'],
                    ['探究素材', '提供视频、图片、数据等支撑材料', '耐克迁移视频、生产地图、成本数据表']
                  ]
                }
              }
            ]
          }
        }
      },
      execution: buildHandExecution({
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_paragraph_edit',
              args: {
                sourcePath: 'prd.docx',
                action: 'replace_text',
                blockId: 'b:31',
                text: '每个探究环节应包含四个核心设计要素：探究目标、探究素材、学生活动设计、环节推进条件。'
              }
            },
            {
              toolName: 'docx_table_edit',
              args: {
                sourcePath: 'prd.docx',
                action: 'insert_after',
                anchorBlockId: 'b:32',
                rows: [
                  ['设计要素', '关键内容', '互动形式示例'],
                  ['探究目标', '明确学生需达成的认知目标', '情境引入、问题聚焦、概念生成'],
                  ['探究素材', '提供视频、图片、数据等支撑材料', '耐克迁移视频、生产地图、成本数据表']
                ]
              }
            }
          ]
        },
        toolResults: [
          {
            toolName: 'docx_paragraph_edit',
            ok: true,
            code: 'ok',
            data: {
              ok: true,
              code: 'ok',
              summary: '段落replace_text 完成，共 1 处变更'
            }
          },
          {
            toolName: 'docx_table_edit',
            ok: true,
            code: 'ok',
            data: {
              ok: true,
              code: 'ok',
              summary: '表格insert_after 完成，共 1 处变更'
            }
          }
        ]
      }),
      createdAt: 3
    })

    const text = renderMouthHistoryText({
      roundHistory: history.roundHistory,
      compactBlocks: []
    })

    expect(text).toContain('`docx_paragraph_edit` 已完成实际写入。')
    expect(text).toContain('每个探究环节应包含四个核心设计要素')
    expect(text).toContain('`docx_table_edit` 已完成实际写入。')
    expect(text).toContain('设计要素')
    expect(text).toContain('互动形式示例')
    expect(text).toContain('耐克迁移视频')
  })
})

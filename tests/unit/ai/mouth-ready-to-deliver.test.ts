import { describe, expect, it } from 'vitest'
import {
  appendRoundRecord,
  buildHandExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildMouthPrompt } from '../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { applyBrainDecisionState, resolveBrainDecisionWatchHint } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const buildMouthDecision = (): HumanDecision => ({
  decision: {
    summary: '尝试收尾',
    reason: '测试 mouth 收尾契约。',
    expectedOutcome: '验证 checklist 对 stage 的影响。'
  },
  nextAction: {
    action: 'mouth'
  }
})

describe('ai unit mouth checklist guard', () => {
  it('keeps the state in brain when mouth is selected before checklist is complete', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision()
    const watchHint = resolveBrainDecisionWatchHint({
      decision,
      stableMemory: {
        ...initialState.memory.stable,
        checklist: [
          {
            item: '完成最终交付前的剩余事项',
            status: 'todo'
          }
        ]
      }
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      stableMemory: {
        ...initialState.memory.stable,
        checklist: [
          {
            item: '完成最终交付前的剩余事项',
            status: 'todo'
          }
        ]
      },
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toEqual({
      code: 'brain_checklist_incomplete',
      detail: {
        pendingItems: ['完成最终交付前的剩余事项']
      }
    })
    expect(nextState.execution.stage).toBe('brain')
    expect(nextState.execution.watchHint).toBe(watchHint)
  })

  it('allows mouth only when checklist has no todo', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision()
    const watchHint = resolveBrainDecisionWatchHint({
      decision,
      stableMemory: {
        ...initialState.memory.stable,
        checklist: [
          {
            item: '完成最终交付前的剩余事项',
            status: 'done'
          }
        ]
      }
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      stableMemory: {
        ...initialState.memory.stable,
        checklist: [
          {
            item: '完成最终交付前的剩余事项',
            status: 'done'
          }
        ]
      },
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toBeUndefined()
    expect(nextState.execution.stage).toBe('mouth')
  })

  it('renders the mouth system contract and keeps disclosure conditional', () => {
    const prompt = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-1',
        userInput: '请完成任务'
      })
    }).system

    expect(prompt).toContain('<context_information>')
    expect(prompt).toContain('<output_contract>')
    expect(prompt).toContain('reference_scope')
    expect(prompt).toContain('delivery_guidance')
    expect(prompt).toContain('面向用户交付最终结果，而不是复述系统内部过程')
    expect(prompt).toContain('优先将其转化为用户容易理解的最终答复')
    expect(prompt).toContain('只输出最终 markdown 正文')
    expect(prompt).toContain('如果需要使用不来自当前上下文的通用知识')
    expect(prompt).toContain('补充说明')
    expect(prompt).toContain('严格按照当前上下文信息回答，不得编造')
  })

  it('keeps mouth user-context blocks data-only', () => {
    const result = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-2',
        userInput: '请根据当前信息给我一个最终答复'
      })
    })

    expect(result.system).toContain('task_goal：用户当前要你完成或回答的事情')
    expect(result.system).toContain('your_notes：当前任务已经收敛的理解、关键依据和完成情况')
    expect(result.system).not.toContain('final_decision')
    expect(result.user).toContain('<reference_scope>')
    expect(result.user).not.toContain('这是当前交付模式。')
    expect(result.user).not.toContain('这是用户这次原始诉求与限制。')
    expect(result.user).toContain('<history>')
    expect(result.user).toContain('<delivery_guidance>')
    expect(result.user).not.toContain('<final_decision>')
    expect(result.user).not.toContain('<correction_hint>')
    expect(result.user).not.toContain('<recalled_history>')
  })

  it('renders mouth history as result-oriented facts and preserves raw diagnostic text', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-3',
      userInput: '继续修正 docx 参数'
    })
    const history = appendRoundRecord({
      state: initialState,
      decision: {
        decision: {
          summary: '重试 docx_text_edit',
          reason: '需要根据失败信息修正参数',
          expectedOutcome: '拿到原始 schema 报错并继续收敛'
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
              error:
                'Received tool input did not match expected schema ✖ Invalid input → at query'
            },
            diagnostic: {
              message:
                'Received tool input did not match expected schema ✖ Invalid input → at query'
            }
          }
        ]
      }),
      createdAt: 1
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        history: {
          ...history,
          loadedHistoryContext: {
            filters: {
              limit: 1
            },
            rounds: history.roundHistory
          }
        }
      }
    }

    const prompt = buildMouthPrompt({ state })

    expect(prompt.user).toContain('已发生的关键结果：')
    expect(prompt.user).toContain('主动回看的相关事实：')
    expect(prompt.user).toContain(
      'Received tool input did not match expected schema ✖ Invalid input → at query'
    )
    expect(prompt.user).not.toContain('调用参数：')
  })

  it('renders key docx_read_blocks facts in mouth prompt', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-4',
      userInput: '按资料说明反走样处理方法'
    })
    const history = appendRoundRecord({
      state: initialState,
      decision: {
        decision: {
          summary: '读取图形学区间',
          reason: '需要按原文说明反走样处理办法',
          expectedOutcome: '拿到完整原文片段'
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

    const prompt = buildMouthPrompt({
      state: {
        ...initialState,
        memory: {
          ...initialState.memory,
          history
        }
      }
    })

    expect(prompt.user).toContain('多个像素点')
    expect(prompt.user).toContain('低通滤波')
    expect(prompt.user).not.toContain('fromBlockId')
  })

  it('renders actual docx write args in mouth history for paragraph and table edits', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-6',
      userInput: '把主稿补充完整并插入表格'
    })
    const history = appendRoundRecord({
      state: initialState,
      decision: {
        decision: {
          summary: '写入主稿段落和表格',
          reason: '当前已经明确知道要写入的正文和表格内容',
          expectedOutcome: '让 mouth 严格依据真实写入内容回答'
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

    const prompt = buildMouthPrompt({
      state: {
        ...initialState,
        memory: {
          ...initialState.memory,
          history
        }
      }
    })

    expect(prompt.user).toContain('`docx_paragraph_edit` 已完成实际写入。')
    expect(prompt.user).toContain('每个探究环节应包含四个核心设计要素')
    expect(prompt.user).toContain('`docx_table_edit` 已完成实际写入。')
    expect(prompt.user).toContain('设计要素')
    expect(prompt.user).toContain('互动形式示例')
    expect(prompt.user).toContain('耐克迁移视频')
  })

  it('renders delivery guidance when present', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-5',
      userInput: '请给我最终答复'
    })

    const prompt = buildMouthPrompt({
      state: {
        ...initialState,
        execution: {
          ...initialState.execution,
          deliveryGuidance:
            '这次没有自动修改原文档，也没有生成审阅稿。请先说明这一点，再给出手动补充建议。'
        }
      }
    })

    expect(prompt.user).toContain('<delivery_guidance>')
    expect(prompt.user).toContain('这次没有自动修改原文档')
  })
})

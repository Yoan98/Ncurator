import { describe, expect, it } from 'vitest'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution,
  filterRoundHistory,
  getEarlierAttemptRounds
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { applyBrainDecisionState } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const buildDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  nextAction: HumanDecision['nextAction']
}): HumanDecision => ({
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  nextAction: input.nextAction
})

describe('ai unit human memory history', () => {
  it('records a pre_execution_blocked round when brain is sent back before execution', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请结束任务'
    })
    const decision = buildDecision({
      summary: '错误地尝试直接收尾',
      reason: '测试 pre_execution_blocked。',
      expectedOutcome: '被系统拦下并回到 brain。',
      nextAction: {
        action: 'mouth'
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
      watchHint: {
        code: 'brain_checklist_incomplete',
        detail: {
          pendingItems: ['完成最终交付前的剩余事项']
        }
      },
      createdAt: 1
    })

    expect(nextState.memory.history.roundHistory).toHaveLength(1)
    expect(nextState.memory.history.roundHistory[0]).toMatchObject({
      roundId: 1,
      createdAt: 1,
      decision,
      execution: {
        kind: 'pre_execution_blocked',
        watchHint: {
          code: 'brain_checklist_incomplete'
        }
      }
    })
  })

  it('keeps the last round out of earlier_attempts and trims the window to twenty rounds', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-2',
      userInput: '请整理历史'
    })

    const stateWithHistory = Array.from({ length: 22 }).reduce((state, _, index) => {
      const round = index + 1
      const decision = buildDecision({
        summary: `第 ${round} 轮决定`,
        reason: `第 ${round} 轮原因`,
        expectedOutcome: `第 ${round} 轮预期`,
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['workspace-cli']
        }
      })

      return {
        ...state,
        memory: {
          ...state.memory,
          history: appendRoundRecord({
            state,
            decision,
            execution:
              round % 2 === 0
                ? buildHandExecution({
                    toolUsePlan: {
                      mode: 'serial',
                      calls: [
                        {
                          toolName: 'workspace_run_command',
                          args: {
                            command: 'pwd'
                          }
                        }
                      ]
                    },
                    toolResults: [
                      {
                        toolName: 'workspace_run_command',
                        ok: true,
                        code: 'ok',
                        data: {
                          ok: true,
                          code: 'ok',
                          outputPreview: `/workspace/round-${round}`
                        }
                      }
                    ]
                  })
                : buildLearningExecution({
                    learningOutcome: {
                      requestedSkillIds: ['workspace-cli'],
                      loadedSkillIds: round === 1 ? ['workspace-cli'] : [],
                      skippedDuplicateSkillIds: round === 1 ? [] : ['workspace-cli'],
                      skippedUnknownSkillIds: [],
                      evictedSkillIds: [],
                      activeToolCount: 1
                    }
                  }),
            createdAt: round
          })
        }
      }
    }, initialState)

    const earlierAttempts = getEarlierAttemptRounds(stateWithHistory)

    expect(stateWithHistory.memory.history.roundHistory.at(-1)?.roundId).toBe(22)
    expect(earlierAttempts.map((record) => record.roundId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    )
  })

  it('appends learning execution into round history after a decision exists', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请学习新的技能'
    })
    const state = {
      ...initialState,
      execution: {
        ...initialState.execution,
        currentDecision: buildDecision({
          summary: '学习 docx-read',
          reason: '需要读取文档结构。',
          expectedOutcome: '补齐 docx 阅读能力。',
          nextAction: {
            action: 'learning',
            wantLearnSkillIds: ['docx-read']
          }
        })
      }
    }

    const nextHistory = appendDecisionRound({
      state,
      execution: buildLearningExecution({
        learningOutcome: {
          requestedSkillIds: ['docx-read'],
          loadedSkillIds: ['docx-read'],
          skippedDuplicateSkillIds: [],
          skippedUnknownSkillIds: [],
          evictedSkillIds: [],
          activeToolCount: 5
        }
      }),
      createdAt: 99
    })

    expect(nextHistory.roundHistory[0]).toMatchObject({
      roundId: 1,
      createdAt: 99,
      execution: {
        kind: 'learning',
        learningOutcome: {
          loadedSkillIds: ['docx-read']
        }
      }
    })
  })

  it('stores raw tool result data in round history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-4',
      userInput: '保存原始工具结果'
    })

    const nextHistory = appendRoundRecord({
      state: initialState,
      decision: buildDecision({
        summary: '读取 docx 片段',
        reason: '需要保留完整 blocks',
        expectedOutcome: 'history 中保留原始 data',
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
      }),
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
                  text: '进行低通滤波，过滤掉高频信号。'
                }
              ]
            }
          }
        ]
      }),
      createdAt: 4
    })

    expect(nextHistory.roundHistory[0]?.execution.kind).toBe('hand')
    if (nextHistory.roundHistory[0]?.execution.kind !== 'hand') {
      throw new Error('expected hand execution')
    }

    expect(nextHistory.roundHistory[0].execution.toolResults[0]?.data).toEqual({
      ok: true,
      code: 'ok',
      sourcePath: 'graphics.docx',
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
          text: '进行低通滤波，过滤掉高频信号。'
        }
      ]
    })
  })

  it('history_search can match keywords from raw tool result tail blocks', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-5',
      userInput: '搜索反走样处理办法'
    })

    const history = appendRoundRecord({
      state: initialState,
      decision: buildDecision({
        summary: '读取图形学文档',
        reason: '需要确认反走样处理办法',
        expectedOutcome: '拿到完整连续区间',
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
      }),
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
              fromBlockId: 'b:19',
              toBlockId: 'b:26',
              returnedBlockCount: 8,
              blocks: [
                {
                  blockId: 'b:19',
                  type: 'paragraph',
                  bodyIndex: 19,
                  text: '反走样'
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
      createdAt: 5
    })

    const filtered = filterRoundHistory({
      roundHistory: history.roundHistory,
      filters: {
        query: '低通滤波',
        limit: 1
      }
    })

    expect(filtered.map((record) => record.roundId)).toEqual([1])
  })

  it('appends new structured delivery guidance instead of replacing existing items', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请完成任务'
    })
    const decision = buildDecision({
      summary: '准备最终交付',
      reason: '当前信息已足够收尾。',
      expectedOutcome: '保留已有 hand guidance，并追加 brain guidance。',
      nextAction: {
        action: 'mouth'
      }
    })
    const nextState = applyBrainDecisionState({
      state: {
        ...initialState,
        execution: {
          ...initialState.execution,
          deliveryGuidanceItems: [
            {
              source: 'hand',
              text: '先说明文档没有被自动修改。'
            }
          ]
        }
      },
      decision: {
        ...decision,
        deliveryGuidance: '再说明通用知识补充不来自当前本地资料。'
      },
      stableMemory: initialState.memory.stable,
      createdAt: 1
    })

    expect(nextState.execution.deliveryGuidanceItems).toEqual([
      {
        source: 'hand',
        text: '先说明文档没有被自动修改。'
      },
      {
        source: 'brain',
        text: '再说明通用知识补充不来自当前本地资料。'
      }
    ])
  })
})

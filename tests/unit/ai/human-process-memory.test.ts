import { describe, expect, it } from 'vitest'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution,
  getCompressibleHistoryRounds,
  getRecentHistoryRounds
} from '../../../src/main/services/ai/human/memory/roundHistory'
import {
  applyBrainDecisionState,
  resolveBrainDecisionWatchHint
} from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanThoughtDecision } from '../../../src/main/services/ai/human/types'

const buildThought = (input: {
  summary: string
  nextAction: HumanThoughtDecision['nextAction']
}): HumanThoughtDecision => ({
  thought: {
    summary: input.summary,
  },
  nextAction: input.nextAction
})

describe('ai unit human memory history', () => {
  it('records a pre_execution_blocked round when brain is sent back before execution', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请结束任务'
    })
    const thought = buildThought({
      summary: '错误地尝试直接收尾',
      nextAction: {
        action: 'mouth'
      }
    })

    const nextState = applyBrainDecisionState({
      state: initialState,
      thought,
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
      thought,
      execution: {
        kind: 'pre_execution_blocked',
        watchHint: {
          code: 'brain_checklist_incomplete'
        }
      }
    })
  })

  it('allows mouth when the remaining checklist items are blocked by tool limit exhaustion', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-tool-limit',
      userInput: '请在预算内尽量完成，否则直接说明未完成部分'
    })
    const thought = buildThought({
      summary: '工具预算已耗尽，准备直接收尾',
      nextAction: {
        action: 'mouth'
      }
    })

    const stateWithToolLimit = {
      ...initialState,
      execution: {
        ...initialState.execution,
        watchHint: {
          code: 'hand_tool_limit_exceeded' as const,
          detail: {
            toolCallCount: 41,
            limit: 40
          }
        }
      }
    }
    const stableMemory = {
      ...initialState.memory.stable,
      checklist: [
        {
          item: '补齐剩余文档修改',
          status: 'todo' as const
        }
      ]
    }
    const watchHint = resolveBrainDecisionWatchHint({
      state: stateWithToolLimit,
      thought,
      stableMemory
    })

    const nextState = applyBrainDecisionState({
      state: stateWithToolLimit,
      thought,
      stableMemory,
      watchHint,
      createdAt: 2
    })

    expect(watchHint).toBeUndefined()
    expect(nextState.execution.stage).toBe('mouth')
    expect(nextState.execution.watchHint).toBeUndefined()
    expect(nextState.memory.history.roundHistory).toHaveLength(0)
  })

  it('clears stale execution references when next action is not mouth', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-clear-references',
      userInput: '继续执行'
    })
    const stateWithReferences = {
      ...initialState,
      execution: {
        ...initialState.execution,
        references: [
          {
            label: 'report.docx',
            path: '/tmp/workspace/report.docx',
            kind: 'internal' as const,
            usedFor: '用于支撑上一次收尾'
          }
        ]
      }
    }

    const nextState = applyBrainDecisionState({
      state: stateWithReferences,
      thought: buildThought({
        summary: '还需要继续读资料',
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['docx-read']
        }
      }),
      stableMemory: initialState.memory.stable,
      createdAt: 3
    })

    expect(nextState.execution.references).toBeUndefined()
  })

  it('keeps the last round out of recent_history and trims the window to twenty rounds', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-2',
      userInput: '请整理历史'
    })

    const stateWithHistory = Array.from({ length: 22 }).reduce((state, _, index) => {
      const round = index + 1
      const thought = buildThought({
        summary: `第 ${round} 轮决定`,
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['docx-read']
        }
      })

      return {
        ...state,
        memory: {
          ...state.memory,
          history: appendRoundRecord({
            state,
            thought,
            execution:
              round % 2 === 0
                ? buildHandExecution({
                    toolUsePlan: {
                      mode: 'serial',
                      calls: [
                        {
                          toolName: 'terminal_run',
                          args: {
                            command: 'pwd'
                          }
                        }
                      ]
                    },
                    toolResults: [
                      {
                        toolName: 'terminal_run',
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
                      requestedSkillIds: ['docx-read'],
                      loadedSkillIds: round === 1 ? ['docx-read'] : [],
                      skippedDuplicateSkillIds: round === 1 ? [] : ['docx-read'],
                      skippedUnknownSkillIds: [],
                      evictedSkillIds: [],
                      activeToolCount: 4
                    }
                  }),
            createdAt: round
          })
        }
      }
    }, initialState)

    const recentHistory = getRecentHistoryRounds(stateWithHistory)

    expect(stateWithHistory.memory.history.roundHistory.at(-1)?.roundId).toBe(22)
    expect(recentHistory.map((record) => record.roundId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    )
  })

  it('uses all non-latest rounds as compaction targets', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-compaction-targets',
      userInput: '请整理历史'
    })

    const stateWithHistory = Array.from({ length: 30 }).reduce((state, _, index) => {
      const round = index + 1
      return {
        ...state,
        memory: {
          ...state.memory,
          history: appendRoundRecord({
            state,
            thought: buildThought({
              summary: `第 ${round} 轮决定`,
              nextAction: {
                action: 'learning',
                wantLearnSkillIds: ['docx-read']
              }
            }),
            execution: buildLearningExecution({
              learningOutcome: {
                requestedSkillIds: ['docx-read'],
                loadedSkillIds: round === 1 ? ['docx-read'] : [],
                skippedDuplicateSkillIds: round === 1 ? [] : ['docx-read'],
                skippedUnknownSkillIds: [],
                evictedSkillIds: [],
                activeToolCount: 4
              }
            }),
            createdAt: round
          })
        }
      }
    }, initialState)

    expect(getRecentHistoryRounds(stateWithHistory).map((record) => record.roundId)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 10)
    )
    expect(getCompressibleHistoryRounds(stateWithHistory).map((record) => record.roundId)).toEqual(
      Array.from({ length: 29 }, (_, index) => index + 1)
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
        currentThought: buildThought({
          summary: '学习 docx-read',
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
      thought: buildThought({
        summary: '读取 docx 片段',
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

  it('preserves existing hand delivery guidance items when brain enters mouth', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请完成任务'
    })
    const thought = buildThought({
      summary: '准备最终交付',
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
      thought,
      stableMemory: initialState.memory.stable,
      createdAt: 1
    })

    expect(nextState.execution.deliveryGuidanceItems).toEqual([
      {
        source: 'hand',
        text: '先说明文档没有被自动修改。'
      }
    ])
  })
})

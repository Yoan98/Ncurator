import { describe, expect, it } from 'vitest'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution,
  getCompressibleHistoryRounds,
  getRecentHistoryRounds
} from '../../../src/main/services/ai/human/memory/rounds'
import { applyThoughtPatch } from '../../../src/main/services/ai/human/memory/thoughtMemory'
import {
  applyBrainDecisionState,
  resolveBrainDecisionHint
} from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanThoughtDecision } from '../../../src/main/services/ai/human/types'

const buildThought = (input: {
  summary: string
  nextAction: HumanThoughtDecision['nextAction']
}): HumanThoughtDecision => ({
  thought: {
    next: input.summary,
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
      thoughtMemory: {
        ...initialState.memory.thought,
        todolist: [
          {
            item: '完成最终交付前的剩余事项',
            status: 'todo'
          }
        ]
      },
      decisionHint: {
        code: 'brain_todolist_incomplete',
        detail: {
          pendingItems: ['完成最终交付前的剩余事项']
        }
      },
      createdAt: 1
    })

    expect(nextState.memory.taskRun.rounds).toHaveLength(1)
    expect(nextState.memory.taskRun.rounds[0]).toMatchObject({
      roundId: 1,
      createdAt: 1,
      thought,
      execution: {
        kind: 'pre_execution_blocked',
        decisionHint: {
          code: 'brain_todolist_incomplete'
        }
      }
    })
  })

  it('allows mouth when the remaining todolist items are blocked by tool limit exhaustion', () => {
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
        pendingDecisionHint: {
          code: 'hand_tool_limit_exceeded' as const,
          detail: {
            toolCallCount: 41,
            limit: 40
          }
        }
      }
    }
    const thoughtMemory = {
      ...initialState.memory.thought,
      todolist: [
        {
          item: '补齐剩余文档修改',
          status: 'todo' as const
        }
      ]
    }
    const decisionHint = resolveBrainDecisionHint({
      state: stateWithToolLimit,
      thought,
      thoughtMemory
    })

    const nextState = applyBrainDecisionState({
      state: stateWithToolLimit,
      thought,
      thoughtMemory,
      decisionHint,
      createdAt: 2
    })

    expect(decisionHint).toBeUndefined()
    expect(nextState.execution.stage).toBe('mouth')
    expect(nextState.execution.pendingDecisionHint).toBeUndefined()
    expect(nextState.memory.taskRun.rounds).toHaveLength(0)
  })

  it('marks the final remaining todo in the mouth-blocked decision hint', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-final-check',
      userInput: '请最终交付'
    })
    const thought = buildThought({
      summary: '准备直接收尾',
      nextAction: {
        action: 'mouth'
      }
    })
    const thoughtMemory = {
      ...initialState.memory.thought,
      todolist: [
        {
          item: '检查是否已经满足用户诉求并能进入最终交付',
          status: 'todo' as const
        }
      ]
    }

    const decisionHint = resolveBrainDecisionHint({
      state: initialState,
      thought,
      thoughtMemory
    })

    expect(decisionHint).toEqual({
      code: 'brain_todolist_incomplete',
      detail: {
        pendingItems: ['检查是否已经满足用户诉求并能进入最终交付']
      }
    })
  })

  it('allows ai to freely rewrite todolist without transition validation', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-free-rewrite',
      userInput: '继续维护任务板'
    })
    const stateWithPreviousTodo = {
      ...initialState,
      memory: {
        ...initialState.memory,
        thought: {
          ...initialState.memory.thought,
          todolist: [
            {
              item: '确认 A 事项',
              status: 'todo' as const
            },
            {
              item: '检查是否已经满足用户诉求并能进入最终交付',
              status: 'todo' as const
            }
          ]
        }
      }
    }
    const thought: HumanThoughtDecision = {
      thought: {
        next: '基于新理解直接重写任务板',
        todolist: [
          {
            item: '跟进新的 C 事项',
            status: 'done'
          },
          {
            item: '检查是否已经满足用户诉求并能进入最终交付',
            status: 'todo'
          }
        ]
      },
      nextAction: {
        action: 'learning',
        wantLearnSkillIds: ['docx-read']
      }
    }

    const decisionHint = resolveBrainDecisionHint({
      state: stateWithPreviousTodo,
      thought,
      thoughtMemory: applyThoughtPatch({
        memory: stateWithPreviousTodo.memory.thought,
        thought: thought.thought
      })
    })

    expect(decisionHint).toBeUndefined()
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
      thoughtMemory: initialState.memory.thought,
      createdAt: 3
    })

    expect(nextState.execution.references).toBeUndefined()
  })

  it('keeps the latest round out of historical rounds and trims the window to twenty rounds', () => {
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
          taskRun: appendRoundRecord({
            state,
            thought,
            execution:
              round % 2 === 0
                ? buildHandExecution({
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'pwd'
                        }
                      }
                    ],
                    toolResults: [
                      {
                        toolName: 'terminal_run',
                        ok: true,
                        code: 'ok',
                        data: {
                          ok: true,
                          code: 'ok',
                          combinedOutput: `/workspace/round-${round}`
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

    expect(stateWithHistory.memory.taskRun.rounds.at(-1)?.roundId).toBe(22)
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
          taskRun: appendRoundRecord({
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

    expect(nextHistory.rounds[0]).toMatchObject({
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
          calls: [
            {
              toolName: 'docx_read_blocks',
              args: {
                sourcePath: 'graphics.docx',
                range: {
                  type: 'block_ids',
                  blockIds: ['b:23', 'b:25']
                }
              }
            }
          ]
        }
      }),
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'docx_read_blocks',
            args: {
              sourcePath: 'graphics.docx',
              range: {
                type: 'block_ids',
                blockIds: ['b:23', 'b:25']
              }
            }
          }
        ],
        toolResults: [
          {
            toolName: 'docx_read_blocks',
            ok: true,
            code: 'ok',
            data: {
              ok: true,
              code: 'ok',
              sourcePath: 'graphics.docx',
              fromBlockIndex: 23,
              toBlockIndex: 25,
              blocks: [
                {
                  blockId: 'b:23',
                  type: 'paragraph',
                  blockIndex: 23,
                  text: '通过模拟一个像素内多个像素点。'
                },
                {
                  blockId: 'b:25',
                  type: 'paragraph',
                  blockIndex: 25,
                  text: '进行低通滤波，过滤掉高频信号。'
                }
              ]
            }
          }
        ]
      }),
      createdAt: 4
    })

    expect(nextHistory.rounds[0]?.execution.kind).toBe('hand')
    if (nextHistory.rounds[0]?.execution.kind !== 'hand') {
      throw new Error('expected hand execution')
    }

    expect(nextHistory.rounds[0].execution.toolResults[0]?.data).toEqual({
      ok: true,
      code: 'ok',
      sourcePath: 'graphics.docx',
      fromBlockIndex: 23,
      toBlockIndex: 25,
      blocks: [
        {
          blockId: 'b:23',
          type: 'paragraph',
          blockIndex: 23,
          text: '通过模拟一个像素内多个像素点。'
        },
        {
          blockId: 'b:25',
          type: 'paragraph',
          blockIndex: 25,
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
      thoughtMemory: initialState.memory.thought,
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

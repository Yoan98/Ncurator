import { describe, expect, it } from 'vitest'
import {
  appendDecisionRound,
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution,
  getHistoryChainRounds
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { applyBrainDecisionState } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const buildDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  nextAction: HumanDecision['nextAction']
  readyToDeliver?: boolean
}): HumanDecision => ({
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  readyToDeliver: input.readyToDeliver || false,
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
      readyToDeliver: false,
      nextAction: {
        action: 'mouth'
      }
    })

    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      stableMemory: initialState.memory.stable,
      watchHint: {
        code: 'brain_invalid_mouth_transition',
        detail: {}
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
          code: 'brain_invalid_mouth_transition'
        }
      }
    })
  })

  it('keeps the last round out of history_chain and trims the chain to five rounds', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-2',
      userInput: '请整理历史'
    })

    const stateWithHistory = Array.from({ length: 7 }).reduce((state, _, index) => {
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
                        toolName: 'terminal_run_command',
                        args: {
                          command: 'pwd'
                        }
                      }
                    ]
                  },
                  toolResults: [
                    {
                      toolName: 'terminal_run_command',
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

    const historyChain = getHistoryChainRounds(stateWithHistory)

    expect(stateWithHistory.memory.history.roundHistory.at(-1)?.roundId).toBe(7)
    expect(historyChain.map((record) => record.roundId)).toEqual([2, 3, 4, 5, 6])
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
})

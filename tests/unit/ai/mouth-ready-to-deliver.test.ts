import { describe, expect, it } from 'vitest'
import {
  appendRoundRecord,
  buildHandExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildMouthPrompt } from '../../../src/main/services/ai/human/prompts/mouth'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { applyBrainDecisionState, resolveBrainDecisionWatchHint } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const buildMouthDecision = (readyToDeliver: boolean): HumanDecision => ({
  decision: {
    summary: '尝试收尾',
    reason: '测试 mouth 收尾契约。',
    expectedOutcome: '验证 readyToDeliver 对 stage 的影响。'
  },
  readyToDeliver,
  nextAction: {
    action: 'mouth'
  }
})

describe('ai unit mouth readyToDeliver guard', () => {
  it('keeps the state in brain when mouth is selected before readyToDeliver', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision(false)
    const watchHint = resolveBrainDecisionWatchHint({
      decision
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      stableMemory: initialState.memory.stable,
      watchHint,
      createdAt: 1
    })

    expect(watchHint).toEqual({
      code: 'brain_invalid_mouth_transition',
      detail: {}
    })
    expect(nextState.execution.stage).toBe('brain')
    expect(nextState.execution.watchHint).toBe(watchHint)
  })

  it('allows mouth only when readyToDeliver is true', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请完成任务'
    })
    const decision = buildMouthDecision(true)
    const watchHint = resolveBrainDecisionWatchHint({
      decision
    })
    const nextState = applyBrainDecisionState({
      state: initialState,
      decision,
      stableMemory: initialState.memory.stable,
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

    expect(prompt).toContain('<available_information>')
    expect(prompt).toContain('<output_contract>')
    expect(prompt).toContain('直接回答 task_goal')
    expect(prompt).toContain('your_notes 优先')
    expect(prompt).toContain('只输出最终 markdown 正文')
    expect(prompt).toContain('如果最终答案补充了不来自当前本地资料的信息')
    expect(prompt).not.toContain('必须在结尾单独加一行“补充说明')
  })

  it('keeps mouth user-context blocks data-only', () => {
    const result = buildMouthPrompt({
      state: createInitialHumanState({
        taskId: 'task-2',
        userInput: '请根据当前信息给我一个最终答复'
      })
    })

    expect(result.system).toContain('task_goal：用户最初要你完成什么')
    expect(result.system).toContain('当前理解：当前任务的最新长期理解')
    expect(result.user).not.toContain('这是当前交付模式。')
    expect(result.user).not.toContain('这是用户这次原始诉求与限制。')
    expect(result.user).toContain('<history>')
    expect(result.user).not.toContain('<correction_hint>')
    expect(result.user).not.toContain('<recalled_history>')
  })

  it('renders unified history and preserves raw diagnostic text in mouth prompt', () => {
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
        readyToDeliver: false,
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

    expect(prompt.user).toContain('过程历史：')
    expect(prompt.user).toContain('主动回看历史：')
    expect(prompt.user).toContain(
      'diagnostic=Received tool input did not match expected schema ✖ Invalid input → at query'
    )
  })
})

import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildBrainPromptContext } from '../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { LastBrainDecision } from '../../../src/main/services/ai/human/types'

const createStubAiRunContext = (selectedContextText: string): AiRunContext => ({
  runId: 'run-test',
  selectedContextText,
  checkCancelled: () => {},
  chatStructured: async () => {
    throw new Error('chatStructured should not be called in prompt unit tests')
  },
  sendEvent: () => {},
  requestApproval: async () => ({
    approved: false
  }),
  loadHistory: async () => ({
    recentTurnsText: '',
    sessionSummaryText: ''
  }),
  trackDocxOpen: () => {},
  trackDocxChanges: () => {},
  resolveDocxOpenTarget: async () => {
    throw new Error('resolveDocxOpenTarget should not be called in prompt unit tests')
  },
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const buildDecision = (input: {
  summary: string
  reason: string
  expectedOutcome: string
  nextAction: LastBrainDecision['nextAction']
}): LastBrainDecision => ({
  memoryOps: [],
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  readyToDeliver: false,
  nextAction: input.nextAction
})

describe('ai unit brain prompt history blocks', () => {
  it('renders the new history-based brain prompt blocks and removes recent_* sections', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-prompt',
      userInput: '请继续推进这个任务'
    })

    const withLearningRound = {
      ...initialState,
      brainMemory: {
        ...initialState.brainMemory,
        outside: {
          ...initialState.brainMemory.outside,
          learnedSkillIds: ['workspace-cli']
        }
      },
      processMemory: appendRoundRecord({
        state: initialState,
        decision: buildDecision({
          summary: '先补齐 workspace 能力',
          reason: '还缺 terminal 能力。',
          expectedOutcome: '拿到命令执行能力后再继续。',
          nextAction: {
            action: 'learning',
            wantLearnSkillIds: ['workspace-cli']
          }
        }),
        execution: buildLearningExecution({
          learningOutcome: {
            requestedSkillIds: ['workspace-cli'],
            loadedSkillIds: ['workspace-cli'],
            skippedDuplicateSkillIds: [],
            skippedUnknownSkillIds: [],
            evictedSkillIds: [],
            activeToolCount: 1
          }
        }),
        createdAt: 1
      })
    }

    const withHandRound = {
      ...withLearningRound,
      processMemory: appendRoundRecord({
        state: withLearningRound,
        decision: buildDecision({
          summary: '读取工作区路径',
          reason: '已经具备 workspace-cli。',
          expectedOutcome: '确认当前 workspace 根路径。',
          nextAction: {
            action: 'hand',
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
            }
          }
        }),
        execution: buildHandExecution({
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
                outputPreview: '/workspace/root'
              }
            }
          ]
        }),
        createdAt: 2
      })
    }

    const state = {
      ...withHandRound,
      processMemory: {
        ...withHandRound.processMemory,
        loadedHistoryContext: {
          filters: {
            executionKinds: ['learning'],
            limit: 1
          },
          rounds: [withHandRound.processMemory.roundHistory[0]]
        }
      }
    }
    const prompt = buildBrainPromptContext({
      state,
      ctx: createStubAiRunContext('这里是用户明确选中的参考资料。')
    })

    expect(prompt.user).toContain('<user_selected_context>')
    expect(prompt.user).toContain('<your_stable_memory>')
    expect(prompt.user).toContain('<your_capabilities>')
    expect(prompt.user).toContain('<last_round_focus>')
    expect(prompt.user).toContain('<history_chain>')
    expect(prompt.user).toContain('<loaded_history_context>')
    expect(prompt.user).toContain('<convergence_hint>')
    expect(prompt.user).not.toContain('<recent_learning_outcome>')
    expect(prompt.user).not.toContain('<recent_tool_results>')
    expect(prompt.user).not.toContain('<recent_decision_history>')
    expect(prompt.user).toContain('history-recall')
    expect(prompt.user).toContain('决策了什么：')
    expect(prompt.user).toContain('做了什么：')
    expect(prompt.user).toContain('结果是什么：')
  })
})

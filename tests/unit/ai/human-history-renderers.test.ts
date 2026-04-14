import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../src/main/services/ai/human/memory/roundHistory'
import { buildBrainPrompt } from '../../../src/main/services/ai/human/prompts/brain'
import { buildMouthPrompt } from '../../../src/main/services/ai/human/prompts/mouth'
import {
  renderRoundSection,
  renderUnifiedHistoryText
} from '../../../src/main/services/ai/human/shared/historyRenderers'
import { buildReferenceScope } from '../../../src/main/services/ai/prompts/referenceScope'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const createStubAiRunContext = (referenceScope: AiRunContext['referenceScope']): AiRunContext => ({
  runId: 'run-history-render',
  referenceScope,
  checkCancelled: () => {},
  chatStructured: async () => {
    throw new Error('chatStructured should not be called in prompt unit tests')
  },
  chatText: async () => {
    throw new Error('chatText should not be called in prompt unit tests')
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
  nextAction: HumanDecision['nextAction']
}): HumanDecision => ({
  decision: {
    summary: input.summary,
    reason: input.reason,
    expectedOutcome: input.expectedOutcome
  },
  readyToDeliver: false,
  nextAction: input.nextAction
})

describe('ai unit human history renderers', () => {
  it('renders shared history facts for both brain and mouth prompts', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-shared',
      userInput: '请总结这次任务做了什么'
    })

    const learningState = {
      ...initialState,
      skills: {
        learnedSkillIds: ['workspace-cli']
      },
      memory: {
        ...initialState.memory,
        history: appendRoundRecord({
          state: initialState,
          decision: buildDecision({
            summary: '补齐 workspace 能力',
            reason: '需要 terminal 工具',
            expectedOutcome: '拿到 workspace 读取能力',
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
    }

    const handState = {
      ...learningState,
      memory: {
        ...learningState.memory,
        history: appendRoundRecord({
          state: learningState,
          decision: buildDecision({
            summary: '读取资料并执行编辑',
            reason: '已经具备需要的能力',
            expectedOutcome: '拿到 docx 编辑结果',
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'serial',
                calls: [
                  {
                    toolName: 'kb_hybrid_search_chunks',
                    args: {
                      queryText: 'approval denied'
                    }
                  },
                  {
                    toolName: 'docx_apply_ops',
                    args: {
                      ops: [
                        {
                          type: 'replace_text',
                          query: 'old',
                          replace: 'new'
                        }
                      ]
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
                  toolName: 'kb_hybrid_search_chunks',
                  args: {
                    queryText: 'approval denied'
                  }
                },
                {
                  toolName: 'docx_apply_ops',
                  args: {
                    ops: [
                      {
                        type: 'replace_text',
                        query: 'old',
                        replace: 'new'
                      }
                    ]
                  }
                }
              ]
            },
            toolResults: [
              {
                toolName: 'kb_hybrid_search_chunks',
                ok: true,
                code: 'ok',
                data: {
                  items: [
                    {
                      document_name: 'Weekly Risk Summary.md',
                      text: '审批未通过时原文件保留'
                    }
                  ]
                }
              },
              {
                toolName: 'docx_apply_ops',
                ok: true,
                code: 'ok',
                data: {
                  newDocId: 'doc-2',
                  summary: 'ops applied (1 changes)'
                }
              }
            ]
          }),
          createdAt: 2
        })
      }
    }

    const state = {
      ...handState,
      memory: {
        ...handState.memory,
        history: {
          ...handState.memory.history,
          loadedHistoryContext: {
            filters: {
              executionKinds: ['learning'],
              limit: 1
            },
            rounds: [handState.memory.history.roundHistory[0]]
          }
        }
      }
    }

    const focusHistory = renderRoundSection({
      records: [state.memory.history.roundHistory[0]],
      detail: 'focus'
    })
    const unifiedHistory = renderUnifiedHistoryText({
      roundHistory: state.memory.history.roundHistory,
      loadedHistoryContext: state.memory.history.loadedHistoryContext
    })

    const brainPrompt = buildBrainPrompt({
      state,
      ctx: createStubAiRunContext(
        buildReferenceScope({
          workspace: {
            workspaceId: 'workspace-1',
            workspaceName: 'workspace',
            rootPath: '/tmp/workspace-root'
          }
        })
      )
    })
    const mouthPrompt = buildMouthPrompt({ state })

    expect(focusHistory).toContain('决策了什么：')
    expect(focusHistory).toContain('做了什么：')
    expect(focusHistory).toContain('结果是什么：')
    expect(unifiedHistory).toContain('过程历史：')
    expect(unifiedHistory).toContain('主动回看历史：')
    expect(unifiedHistory).toContain('Weekly Risk Summary.md')
    expect(unifiedHistory).toContain('ops applied (1 changes)')
    expect(brainPrompt.user).toContain(focusHistory)
    expect(mouthPrompt.user).toContain(unifiedHistory)
  })
})

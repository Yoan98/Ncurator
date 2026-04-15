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
                    toolName: 'kb_search',
                    args: {
                      queryText: 'approval denied'
                    }
                  },
                  {
                    toolName: 'docx_text_edit',
                    args: {
                      query: 'old',
                      replace: 'new'
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
                  toolName: 'kb_search',
                  args: {
                    queryText: 'approval denied'
                  }
                },
                {
                  toolName: 'docx_text_edit',
                  args: {
                    query: 'old',
                    replace: 'new'
                  }
                }
              ]
            },
            toolResults: [
              {
                toolName: 'kb_search',
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
                toolName: 'docx_text_edit',
                ok: true,
                code: 'ok',
                resourceContext: {
                  family: 'docx',
                  sourcePath: 'weekly-risk.docx',
                  previousVersionRef: 'v1',
                  currentVersionRef: 'v2',
                  effectKind: 'mutated'
                },
                data: {
                  sourcePath: 'weekly-risk.docx',
                  previousVersionRef: 'v1',
                  currentVersionRef: 'v2',
                  summary: '文本替换完成，共 1 处变更'
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
    expect(unifiedHistory).toContain('文本替换完成，共 1 处变更')
    expect(brainPrompt.user).toContain(focusHistory)
    expect(mouthPrompt.user).toContain(unifiedHistory)
  })

  it('preserves raw diagnostic message text in rendered history', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-history-diagnostic',
      userInput: '继续修正 docx 参数'
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        history: appendRoundRecord({
          state: initialState,
          decision: buildDecision({
            summary: '重试 docx_text_edit',
            reason: '需要根据失败信息修正参数',
            expectedOutcome: '拿到原始 schema 报错并继续收敛',
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
          }),
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
      }
    }

    const rendered = renderRoundSection({
      records: state.memory.history.roundHistory,
      detail: 'loaded'
    })

    expect(rendered).toContain(
      'diagnostic=Received tool input did not match expected schema ✖ Invalid input → at query'
    )
  })
})

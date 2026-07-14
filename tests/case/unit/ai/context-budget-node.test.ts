import { describe, expect, it } from 'vitest'
import { createContextBudgetNode } from '../../../../src/main/services/ai/human/node/contextBudgetNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  appendRoundRecord,
  buildLearningExecution
} from '../../../../src/main/services/ai/human/memory/rounds'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from '../../../../src/main/services/ai/human/constants'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { AiRunEvent } from '../../../../src/shared/types'

const DEFAULT_COMPACTION_TRIGGER_TOKENS = Math.floor(
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS * CONTEXT_COMPACTION_TRIGGER_RATIO
)

const createBaseContext = (events: AiRunEvent[]): AiRunContext =>
  ({
    runId: 'run-1',
    platform: 'macos',
    referenceScope: {
      workspace: {
        workspaceId: 'ws-1',
        workspaceName: 'Workspace',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    },
    workspace: {
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      rootPath: '/tmp/workspace'
    },
    checkCancelled: () => undefined,
    chatStructured: async () => {
      throw new Error('not used in context budget test')
    },
    chatText: async () => {
      throw new Error('not used in context budget test')
    },
    sendEvent: (event) => events.push(event),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
    loadConversationContext: async () => ({
      recentTurnsText: '',
      conversationSummaryText: ''
    }),
    loadConversationMemory: async () => null,
    trackDocxOpen: () => undefined,
    trackDocxChanges: () => undefined,
    trackDocxBatchChanges: () => undefined,
    resolveDocxOpenTarget: async () => {
      throw new Error('not used in context budget test')
    },
    beginDocxApplyRun: () => undefined,
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => undefined,
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) satisfies AiRunContext

describe('ai unit context budget node', () => {
  it('records continue decision with brain context budget snapshot', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '帮我确认当前任务进度。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    expect(nextState.execution.contextBudget).toMatchObject({
      basis: 'initial',
      budgetTokens: 0,
      contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      compactionTriggerTokens: DEFAULT_COMPACTION_TRIGGER_TOKENS,
      hasCompressibleHistory: false,
      usageAvailable: false,
      evaluationId: expect.any(String)
    })
    const event = events.find((item) => item.type === 'context_budget_evaluated')
    expect(event).toMatchObject({
      type: 'context_budget_evaluated',
      runId: 'run-1',
      taskId: 'task-1',
      stage: 'human_brain',
      decision: 'continue',
      snapshot: nextState.execution.contextBudget
    })
  })

  it('records compact decision when over trigger and compressible history exists', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const baseState = createInitialHumanState({
      taskId: 'task-2',
      userInput: '请完成一个会触发压缩的长任务。'
    })
    const roundState = {
      ...baseState,
      memory: {
        ...baseState.memory,
        taskRun: (() => {
          const stateWithRound1 = {
            ...baseState,
            memory: {
              ...baseState.memory,
              taskRun: appendRoundRecord({
                state: baseState,
                thought: {
                  thought: {
                    next: `第一轮先学习 docx-read。${'需要保留的长历史。'.repeat(40)}`
                  },
                  nextAction: {
                    action: 'learning',
                    wantLearnSkillIds: ['docx-read']
                  }
                },
                execution: buildLearningExecution({
                  learningOutcome: {
                    requestedSkillIds: ['docx-read'],
                    loadedSkillIds: ['docx-read'],
                    skippedDuplicateSkillIds: [],
                    skippedUnknownSkillIds: [],
                    evictedSkillIds: [],
                    activeToolCount: 4
                  }
                }),
                createdAt: 1
              })
            }
          }
          return appendRoundRecord({
            state: stateWithRound1,
            thought: {
              thought: {
                next: '第二轮继续学习 docx-write。'
              },
              nextAction: {
                action: 'learning',
                wantLearnSkillIds: ['docx-write']
              }
            },
            execution: buildLearningExecution({
              learningOutcome: {
                requestedSkillIds: ['docx-write'],
                loadedSkillIds: ['docx-write'],
                skippedDuplicateSkillIds: [],
                skippedUnknownSkillIds: [],
                evictedSkillIds: [],
                activeToolCount: 8
              }
            }),
            createdAt: 2
          })
        })()
      },
      humanRuntimeOverrides: undefined
    }
    const ctxWithSmallWindow = {
      ...ctx,
      humanRuntimeOverrides: {
        modelContextWindowTokens: 600
      }
    } satisfies AiRunContext
    const smallWindowNode = createContextBudgetNode({
      ctx: ctxWithSmallWindow,
      cache
    })
    cache.lastBrainInputTokens = 500
    cache.lastBrainRoundCount = 1

    const nextState = await smallWindowNode(roundState)

    expect(nextState.execution.stage).toBe('context_compaction')
    const event = events.find((item) => item.type === 'context_budget_evaluated')
    expect(event).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'compact',
      snapshot: {
        basis: 'usage_plus_delta',
        budgetTokens: expect.any(Number),
        hasCompressibleHistory: true,
        usageAvailable: true,
        lastBrainInputTokens: 500,
        deltaTokenEstimate: expect.any(Number),
        contextWindowTokens: 600,
        compactionTriggerTokens: 480
      }
    })
  })

  it('records continue decision with usage_unavailable basis when brain usage is missing', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    cache.lastBrainUsageUnavailable = true
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请确认当前任务状态。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    const budgetEvent = events.find((item) => item.type === 'context_budget_evaluated')
    expect(budgetEvent).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'continue',
      snapshot: {
        basis: 'usage_unavailable',
        budgetTokens: 0,
        usageAvailable: false,
        hasCompressibleHistory: false,
        contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
      }
    })
  })

  it('does not compact when the available round history is too small to reduce context', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const baseState = createInitialHumanState({
      taskId: 'task-small-history',
      userInput: '请继续当前任务。'
    })
    const firstTaskRun = appendRoundRecord({
      state: baseState,
      thought: {
        thought: { next: '继续。' },
        nextAction: { action: 'learning', wantLearnSkillIds: ['docx-read'] }
      },
      execution: buildLearningExecution({
        learningOutcome: {
          requestedSkillIds: ['docx-read'],
          loadedSkillIds: ['docx-read'],
          skippedDuplicateSkillIds: [],
          skippedUnknownSkillIds: [],
          evictedSkillIds: [],
          activeToolCount: 4
        }
      }),
      createdAt: 1
    })
    const firstRoundState = {
      ...baseState,
      memory: {
        ...baseState.memory,
        taskRun: firstTaskRun
      }
    }
    const secondTaskRun = appendRoundRecord({
      state: firstRoundState,
      thought: {
        thought: { next: '完成。' },
        nextAction: { action: 'learning', wantLearnSkillIds: ['docx-write'] }
      },
      execution: buildLearningExecution({
        learningOutcome: {
          requestedSkillIds: ['docx-write'],
          loadedSkillIds: ['docx-write'],
          skippedDuplicateSkillIds: [],
          skippedUnknownSkillIds: [],
          evictedSkillIds: [],
          activeToolCount: 8
        }
      }),
      createdAt: 2
    })
    const roundState = {
      ...firstRoundState,
      memory: {
        ...firstRoundState.memory,
        taskRun: secondTaskRun
      }
    }
    const node = createContextBudgetNode({
      ctx: {
        ...ctx,
        humanRuntimeOverrides: { modelContextWindowTokens: 10_000 }
      },
      cache
    })
    cache.lastBrainInputTokens = 9_000
    cache.lastBrainRoundCount = 1

    const nextState = await node(roundState)

    expect(nextState.execution.stage).toBe('brain')
    expect(events.find((event) => event.type === 'context_budget_evaluated')).toMatchObject({
      decision: 'continue'
    })
  })

  it('records continue decision with post_compaction basis after compaction clears usage baseline', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    cache.postCompactionNeedsFreshBrainUsage = true
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-4',
      userInput: '继续推进压缩后的任务。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    const budgetEvent = events.find((item) => item.type === 'context_budget_evaluated')
    expect(budgetEvent).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'continue',
      snapshot: {
        basis: 'post_compaction',
        budgetTokens: 0,
        usageAvailable: false,
        contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
      }
    })
  })
})

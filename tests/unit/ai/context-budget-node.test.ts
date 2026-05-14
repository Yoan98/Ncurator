import { describe, expect, it } from 'vitest'
import { createContextBudgetNode } from '../../../src/main/services/ai/human/node/contextBudgetNode'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import {
  appendRoundRecord,
  buildLearningExecution
} from '../../../src/main/services/ai/human/memory/rounds'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { AiRunEvent } from '../../../src/shared/types'

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
    requestApproval: async () => ({ approved: true }),
    loadConversationContext: async () => ({
      recentTurnsText: '',
      conversationSummaryText: ''
    }),
    loadConversationMemory: async () => null,
    trackDocxOpen: () => undefined,
    trackDocxChanges: () => undefined,
    resolveDocxOpenTarget: async () => {
      throw new Error('not used in context budget test')
    },
    beginDocxReviewRun: () => undefined,
    finalizeDocxReviewRun: async () => [],
    persistDocxReviewRun: async () => undefined,
    discardDocxReviewRun: () => undefined,
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
      tokenEstimate: expect.any(Number),
      contextWindowTokens: 200000,
      compactionTriggerTokens: 160000,
      hasCompressibleHistory: false,
      evaluationId: expect.any(String)
    })
    const event = events.find(
      (item) => item.type === 'context_budget_evaluated'
    )
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
    const node = createContextBudgetNode({ ctx, cache })
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
                    next: '第一轮先学习 docx-read。'
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

    const nextState = await smallWindowNode(roundState)

    expect(nextState.execution.stage).toBe('context_compaction')
    const event = events.find(
      (item) => item.type === 'context_budget_evaluated'
    )
    expect(event).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'compact',
      snapshot: {
        hasCompressibleHistory: true,
        contextWindowTokens: 600,
        compactionTriggerTokens: 480
      }
    })
  })

  it('records fail_over_window decision before throwing when no compressible history exists', async () => {
    const events: AiRunEvent[] = []
    const ctx = {
      ...createBaseContext(events),
      humanRuntimeOverrides: {
        modelContextWindowTokens: 10
      }
    } satisfies AiRunContext
    const cache = createHumanRuntimeCache()
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请重复输出一段很长很长很长的描述，用于压测上下文窗口是否会超限。'.repeat(20)
    })

    await expect(node(state)).rejects.toThrow('超过模型窗口')

    const budgetEvent = events.find(
      (item) => item.type === 'context_budget_evaluated'
    )
    expect(budgetEvent).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'fail_over_window',
      snapshot: {
        hasCompressibleHistory: false,
        contextWindowTokens: 10
      }
    })
    const runtimeIssue = events.find((item) => item.type === 'runtime_issue')
    expect(runtimeIssue).toMatchObject({
      type: 'runtime_issue',
      code: 'context_window_exceeded'
    })
  })
})

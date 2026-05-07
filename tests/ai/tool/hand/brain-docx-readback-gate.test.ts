import { describe, expect, it } from 'vitest'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { applyBrainDecisionTransition } from '../../../../src/main/services/ai/human/node/utils/stateTransitions'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { HumanDecision } from '../../../../src/main/services/ai/human/types'

const createStubAiRunContext = (): AiRunContext => ({
  runId: 'run-brain-docx-readback-gate',
  referenceScope: {
    workspace: {
      workspaceId: 'workspace-1',
      workspaceName: 'workspace',
      rootPath: '/tmp/workspace-root'
    },
    selectedReferences: [],
    hasExplicitSelectedReferences: false,
    hasDirectDocumentNarrowing: false,
    defaultKnowledgeScope: 'current_workspace'
  },
  workspace: {
    workspaceId: 'workspace-1',
    workspaceName: 'workspace',
    rootPath: '/tmp/workspace-root'
  },
  checkCancelled: () => {},
  chatStructured: async () => {
    throw new Error('chatStructured should not be called in this unit test')
  },
  chatText: async () => {
    throw new Error('chatText should not be called in this unit test')
  },
  sendEvent: () => {},
  requestApproval: async () => ({ approved: false }),
  loadHistory: async () => ({
    recentTurnsText: '',
    sessionSummaryText: ''
  }),
  trackDocxOpen: () => {},
  trackDocxChanges: () => {},
  resolveDocxOpenTarget: async () => {
    throw new Error('resolveDocxOpenTarget should not be called in this unit test')
  },
  beginDocxReviewRun: () => {},
  finalizeDocxReviewRun: async () => [],
  persistDocxReviewRun: async () => {},
  discardDocxReviewRun: () => {},
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const buildStateWithReadbackHint = (sourcePath = '/tmp/workspace-root/report.docx') => ({
  ...createInitialHumanState({
    taskId: 'task-brain-docx-readback-gate',
    userInput: 'test'
  }),
  execution: {
    ...createInitialHumanState({
      taskId: 'task-brain-docx-readback-gate',
      userInput: 'test'
    }).execution,
    watchHint: {
      code: 'docx_write_requires_readback' as const,
      detail: {
        sourcePaths: [sourcePath],
        latestRevisionRefs: ['v3'],
        suggestedToolNames: ['docx_outline', 'docx_read_blocks']
      }
    }
  }
})

describe('ai tool hand backend', () => {
  it('brain-docx-readback-gate', () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const baseState = buildStateWithReadbackHint()

    const mouthDecision: HumanDecision = {
      decision: {
        summary: '直接结束',
        reason: '故意测试 gate',
        expectedOutcome: '应被阻断'
      },
      nextAction: {
        action: 'mouth'
      }
    }

    const blockedMouth = applyBrainDecisionTransition({
      ctx,
      cache,
      state: baseState,
      decision: mouthDecision,
      stableMemory: baseState.memory.stable
    })

    expect(blockedMouth.execution.stage).toBe('brain')
    expect(blockedMouth.execution.watchHint?.code).toBe('docx_write_requires_readback')

    const readDecision: HumanDecision = {
      decision: {
        summary: '先 readback',
        reason: '满足 gate',
        expectedOutcome: '允许进入 hand'
      },
      nextAction: {
        action: 'hand',
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_outline',
              args: {
                sourcePath: 'report.docx'
              }
            }
          ]
        }
      }
    }

    const allowedRead = applyBrainDecisionTransition({
      ctx,
      cache,
      state: baseState,
      decision: readDecision,
      stableMemory: baseState.memory.stable
    })

    expect(allowedRead.execution.stage).toBe('hand')
    expect(allowedRead.execution.watchHint).toBeUndefined()
  })

  it('allows readback when the model uses a dot-prefixed workspace relative path', () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const baseState = buildStateWithReadbackHint('/tmp/workspace-root/工作/本周周报.docx')

    const readDecision: HumanDecision = {
      decision: {
        summary: '先 readback',
        reason: '满足 gate',
        expectedOutcome: '允许进入 hand'
      },
      nextAction: {
        action: 'hand',
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_outline',
              args: {
                sourcePath: './工作/本周周报.docx'
              }
            }
          ]
        }
      }
    }

    const allowedRead = applyBrainDecisionTransition({
      ctx,
      cache,
      state: baseState,
      decision: readDecision,
      stableMemory: baseState.memory.stable
    })

    expect(allowedRead.execution.stage).toBe('hand')
    expect(allowedRead.execution.watchHint).toBeUndefined()
  })

  it('keeps blocking readback attempts for a different docx path', () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const baseState = buildStateWithReadbackHint('/tmp/workspace-root/工作/本周周报.docx')

    const readDecision: HumanDecision = {
      decision: {
        summary: '读另一个文件',
        reason: '故意测试 gate',
        expectedOutcome: '应被阻断'
      },
      nextAction: {
        action: 'hand',
        toolUsePlan: {
          mode: 'serial',
          calls: [
            {
              toolName: 'docx_outline',
              args: {
                sourcePath: './工作/其他周报.docx'
              }
            }
          ]
        }
      }
    }

    const blockedRead = applyBrainDecisionTransition({
      ctx,
      cache,
      state: baseState,
      decision: readDecision,
      stableMemory: baseState.memory.stable
    })

    expect(blockedRead.execution.stage).toBe('brain')
    expect(blockedRead.execution.watchHint?.code).toBe('docx_write_requires_readback')
  })
})

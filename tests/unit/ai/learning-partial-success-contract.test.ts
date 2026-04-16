import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { createLearningNode } from '../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import type { HumanDecision } from '../../../src/main/services/ai/human/types'

const createStubAiRunContext = (): AiRunContext => ({
  runId: 'run-learning-unit',
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
    throw new Error('chatStructured should not be called in learning unit tests')
  },
  chatText: async () => {
    throw new Error('chatText should not be called in learning unit tests')
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
    throw new Error('resolveDocxOpenTarget should not be called in learning unit tests')
  },
  beginDocxReviewRun: () => {},
  finalizeDocxReviewRun: async () => [],
  discardDocxReviewRun: () => {},
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const buildLearningDecision = (skillIds: string[]): HumanDecision => ({
  decision: {
    summary: '测试 learning partial success',
    reason: '验证 learning 会加载新 skill，并跳过重复或未知 skill。',
    expectedOutcome: '写出 lastLearningOutcome 并返回 brain。'
  },
  readyToDeliver: false,
  nextAction: {
    action: 'learning' as const,
    wantLearnSkillIds: skillIds
  }
})

describe('ai unit learning partial success', () => {
  it('loads new skills while skipping duplicates', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-duplicate-plus-new',
      userInput: '请学习 workspace-cli 和 docx-read'
    })

    const nextState = await learningNode({
      ...baseState,
      skills: {
        learnedSkillIds: ['workspace-cli']
      },
      execution: {
        ...baseState.execution,
        currentDecision: buildLearningDecision(['workspace-cli', 'docx-read'])
      }
    })

    expect(nextState.execution.watchHint).toBeUndefined()
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['docx-read'],
      skippedDuplicateSkillIds: ['workspace-cli'],
      skippedUnknownSkillIds: []
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['workspace-cli', 'docx-read'])
    expect(nextState.memory.history.roundHistory.at(-1)?.execution.kind).toBe('learning')
    expect(cache.skillToolsets['docx-read']).toBeTruthy()
  })

  it('loads known skills while skipping unknown ones', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-unknown-plus-new',
      userInput: '请学习 unknown-skill 和 workspace-cli'
    })

    const nextState = await learningNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        currentDecision: buildLearningDecision(['unknown-skill', 'workspace-cli'])
      }
    })

    expect(nextState.execution.watchHint).toBeUndefined()
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['workspace-cli'],
      skippedUnknownSkillIds: ['unknown-skill']
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['workspace-cli'])
    expect(nextState.memory.history.roundHistory.at(-1)?.execution.kind).toBe('learning')
  })

  it('treats builtin-only requests as no effect', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-builtin-only',
      userInput: '请学习 history-recall'
    })

    const nextState = await learningNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        currentDecision: buildLearningDecision(['history-recall'])
      }
    })

    expect(nextState.execution.watchHint).toMatchObject({
      code: 'learning_no_effect'
    })
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: [],
      skippedDuplicateSkillIds: ['history-recall']
    })
    expect(nextState.skills.learnedSkillIds).toEqual([])
    expect(nextState.memory.history.roundHistory.at(-1)?.execution.kind).toBe('learning')
  })
})

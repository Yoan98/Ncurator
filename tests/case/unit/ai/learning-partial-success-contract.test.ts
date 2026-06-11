import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { HumanThoughtDecision } from '../../../../src/main/services/ai/human/types'

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
  requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
  loadConversationContext: async () => ({
    recentTurnsText: '',
    conversationSummaryText: ''
  }),
  loadConversationMemory: async () => null,
  trackDocxOpen: () => {},
  trackDocxChanges: () => {},
  trackDocxBatchChanges: () => {},
  resolveDocxOpenTarget: async () => {
    throw new Error('resolveDocxOpenTarget should not be called in learning unit tests')
  },
  beginDocxApplyRun: () => {},
  applyDocxRunEdits: async () => [],
  discardDocxApplyRun: () => {},
  documentsStore: undefined as never,
  embeddingService: undefined as never
})

const buildLearningDecision = (skillIds: string[]): HumanThoughtDecision => ({
  thought: {
    next: '测试 learning partial success'
  },
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
      userInput: '请学习 docx-read 和 docx-write'
    })

    const nextState = await learningNode({
      ...baseState,
      skills: {
        learnedSkillIds: ['docx-read']
      },
      execution: {
        ...baseState.execution,
        currentThought: buildLearningDecision(['docx-read', 'docx-write'])
      }
    })

    expect(nextState.execution.pendingDecisionHint).toBeUndefined()
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['docx-write'],
      skippedDuplicateSkillIds: ['docx-read'],
      skippedUnknownSkillIds: []
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['docx-read', 'docx-write'])
    expect(nextState.memory.taskRun.rounds.at(-1)?.execution.kind).toBe('learning')
    expect(cache.skillToolsets['docx-write']).toBeTruthy()
  })

  it('loads known skills while skipping unknown ones', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-unknown-plus-new',
      userInput: '请学习 unknown-skill 和 docx-read'
    })

    const nextState = await learningNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        currentThought: buildLearningDecision(['unknown-skill', 'docx-read'])
      }
    })

    expect(nextState.execution.pendingDecisionHint).toBeUndefined()
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['docx-read'],
      skippedUnknownSkillIds: ['unknown-skill']
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['docx-read'])
    expect(nextState.memory.taskRun.rounds.at(-1)?.execution.kind).toBe('learning')
  })

  it('treats builtin-only requests as invalid learning', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-builtin-only',
      userInput: '请学习 terminal'
    })

    const nextState = await learningNode({
      ...baseState,
      execution: {
        ...baseState.execution,
        currentThought: buildLearningDecision(['terminal'])
      }
    })

    expect(nextState.execution.pendingDecisionHint).toMatchObject({
      code: 'learning_no_effect',
      detail: {
        requestedSkillIds: ['terminal'],
        duplicateSkillIds: [],
        unknownSkillIds: []
      }
    })
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: [],
      skippedDuplicateSkillIds: []
    })
    expect(nextState.skills.learnedSkillIds).toEqual([])
    expect(nextState.memory.taskRun.rounds.at(-1)?.execution.kind).toBe('learning')
  })

  it('rejects states whose learnedSkillIds still contain builtin skills', async () => {
    const ctx = createStubAiRunContext()
    const cache = createHumanRuntimeCache()
    const learningNode = createLearningNode({ ctx, cache })
    const baseState = createInitialHumanState({
      taskId: 'task-invalid-learned-skill-state',
      userInput: '请继续任务'
    })

    await expect(
      learningNode({
        ...baseState,
        skills: {
          learnedSkillIds: ['terminal']
        },
        execution: {
          ...baseState.execution,
          currentThought: buildLearningDecision(['docx-read'])
        }
      })
    ).rejects.toThrow('learnedSkillIds 只允许 external skill')
  })
})

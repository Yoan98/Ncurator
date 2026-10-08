import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { humanNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

const createStubAiRunContext = (): AiRunContext =>
  ({
    runId: 'run-learning-unit',
    partnerId: 'partner-learning-unit',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace-root'],
    runStartedAt: 0,
    platform: 'macos',
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
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
    loadMessageLog: async () => [],
    appendMessageLog: async () => undefined,
    trackDocxOpen: async () => {},
    trackDocxChanges: () => {},
    resolveDocxOpenTarget: async () => {
      throw new Error('resolveDocxOpenTarget should not be called in learning unit tests')
    },
    beginDocxApplyRun: () => {},
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => {},
    documentsStore: undefined as never,
    embeddingService: undefined as never
  }) as AiRunContext

const buildLearningDecision = (
  skillIds: string[]
): {
  thought: { text: string }
  nextAction: { action: 'learning'; wantLearnSkillIds: string[]; toolCallId: string }
} => ({
  thought: {
    text: '测试 learning partial success'
  },
  nextAction: {
    action: 'learning' as const,
    wantLearnSkillIds: skillIds,
    toolCallId: 'learn-call-1'
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
        pendingRound: buildLearningDecision(['docx-read', 'docx-write'])
      }
    })

    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['docx-write'],
      skippedDuplicateSkillIds: ['docx-read'],
      skippedUnknownSkillIds: []
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['docx-read', 'docx-write'])
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'learn_skill',
      skillId: 'docx-write'
    })
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
        pendingRound: buildLearningDecision(['unknown-skill', 'docx-read'])
      }
    })

    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      loadedSkillIds: ['docx-read'],
      skippedUnknownSkillIds: ['unknown-skill']
    })
    expect(nextState.skills.learnedSkillIds).toEqual(['docx-read'])
    expect(nextState.trace.steps.at(-1)).toMatchObject({
      action: 'learn_skill',
      skillId: 'docx-read'
    })
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
        pendingRound: buildLearningDecision(['terminal'])
      }
    })

    expect(nextState.execution.stage).toBe('dispatch')
    expect(nextState.execution.lastLearningOutcome).toMatchObject({
      requestedSkillIds: ['terminal'],
      loadedSkillIds: [],
      skippedDuplicateSkillIds: [],
      skippedUnknownSkillIds: []
    })
    expect(nextState.skills.learnedSkillIds).toEqual([])
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
          pendingRound: buildLearningDecision(['docx-read'])
        }
      })
    ).rejects.toThrow('learnedSkillIds 只允许 external skill')
  })

  it('allows learning decisions to request three or more skills', () => {
    expect(
      humanNextActionSchema.parse({
        action: 'learning',
        toolCallId: 'call-learning-budget',
        wantLearnSkillIds: ['docx-read', 'docx-write', 'pdf-read', 'excel-write']
      })
    ).toMatchObject({
      action: 'learning',
      wantLearnSkillIds: ['docx-read', 'docx-write', 'pdf-read', 'excel-write']
    })
  })
})

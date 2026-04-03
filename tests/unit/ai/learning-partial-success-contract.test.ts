import { describe, it } from 'vitest'
import { createLearningNode } from '../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../harness/backend/run-backend-case'

const buildLearningDecision = (skillIds: string[]) => ({
  memoryOps: [],
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

describe('ai human backend', () => {
  it('learning-partial-success-contract', async () => {
    await runBackendCase({
      caseId: 'learning-partial-success-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'human',
      groups: ['learning'],
      description: '验证 learning 对重复和未知 skill 采用 partial success，而不是整批失败。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        const learningNode = createLearningNode({ ctx, cache })

        const duplicatePlusNewBase = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请学习 workspace-cli 和 docx-read'
        })
        const duplicatePlusNewState = await learningNode({
          ...duplicatePlusNewBase,
          brainMemory: {
            ...duplicatePlusNewBase.brainMemory,
            outside: {
              ...duplicatePlusNewBase.brainMemory.outside,
              learnedSkillIds: ['workspace-cli']
            }
          },
          lastBrainDecision: buildLearningDecision(['workspace-cli', 'docx-read'])
        })

        const unknownPlusNewBase = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请学习 unknown-skill 和 workspace-cli'
        })
        const unknownPlusNewState = await learningNode({
          ...unknownPlusNewBase,
          lastBrainDecision: buildLearningDecision(['unknown-skill', 'workspace-cli'])
        })

        const builtinOnlyBase = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请学习 history-recall'
        })
        const builtinOnlyState = await learningNode({
          ...builtinOnlyBase,
          lastBrainDecision: buildLearningDecision(['history-recall'])
        })

        return {
          duplicatePlusNewState,
          unknownPlusNewState,
          builtinOnlyState
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.duplicatePlusNewState.watchHint &&
            result.duplicatePlusNewState.lastLearningOutcome?.loadedSkillIds.includes('docx-read') &&
            result.duplicatePlusNewState.lastLearningOutcome?.skippedDuplicateSkillIds.includes(
              'workspace-cli'
            ) &&
            result.duplicatePlusNewState.lastLearningOutcome?.skippedUnknownSkillIds.length === 0 &&
            result.duplicatePlusNewState.brainMemory.outside.learnedSkillIds.includes('workspace-cli') &&
            result.duplicatePlusNewState.brainMemory.outside.learnedSkillIds.includes('docx-read') &&
            result.duplicatePlusNewState.processMemory.roundHistory.at(-1)?.execution.kind === 'learning',
          {
            name: 'learning-loads-new-skills-and-skips-duplicates',
            message: '当请求里既有重复 skill 又有新 skill 时，learning 应只加载新 skill，不发 watchHint。',
            data: {
              watchHint: result.duplicatePlusNewState.watchHint,
              lastLearningOutcome: result.duplicatePlusNewState.lastLearningOutcome,
              learnedSkillIds: result.duplicatePlusNewState.brainMemory.outside.learnedSkillIds,
              latestRound: result.duplicatePlusNewState.processMemory.roundHistory.at(-1)
            }
          }
        )

        runtime.assertThat(
          !result.unknownPlusNewState.watchHint &&
            result.unknownPlusNewState.lastLearningOutcome?.loadedSkillIds.includes('workspace-cli') &&
            result.unknownPlusNewState.lastLearningOutcome?.skippedUnknownSkillIds.includes(
              'unknown-skill'
            ) &&
            result.unknownPlusNewState.brainMemory.outside.learnedSkillIds.includes('workspace-cli'),
          {
            name: 'learning-loads-known-skills-and-skips-unknown',
            message: '当请求里既有未知 skill 又有新 skill 时，learning 应只加载已知 skill，不发 watchHint。',
            data: {
              watchHint: result.unknownPlusNewState.watchHint,
              lastLearningOutcome: result.unknownPlusNewState.lastLearningOutcome,
              learnedSkillIds: result.unknownPlusNewState.brainMemory.outside.learnedSkillIds
            }
          }
        )

        runtime.assertThat(
          result.builtinOnlyState.watchHint?.code === 'learning_no_effect' &&
            result.builtinOnlyState.lastLearningOutcome?.loadedSkillIds.length === 0 &&
            result.builtinOnlyState.lastLearningOutcome?.skippedDuplicateSkillIds.includes(
              'history-recall'
            ) &&
            !result.builtinOnlyState.brainMemory.outside.learnedSkillIds.includes('history-recall'),
          {
            name: 'learning-does-not-learn-builtin-skills',
            message: 'builtin skill 应视为始终可用，而不是可学习的外置 skill。',
            data: {
              watchHint: result.builtinOnlyState.watchHint,
              lastLearningOutcome: result.builtinOnlyState.lastLearningOutcome,
              learnedSkillIds: result.builtinOnlyState.brainMemory.outside.learnedSkillIds
            }
          }
        )
      }
    })
  })
})

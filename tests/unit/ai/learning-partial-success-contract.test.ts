import { describe, it } from 'vitest'
import { createLearningNode } from '../../../src/main/services/ai/human/node/learningNode'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../harness/backend/run-backend-case'

const buildLearningDecision = (skillIds: string[]) => ({
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
          skills: {
            learnedSkillIds: ['workspace-cli']
          },
          execution: {
            ...duplicatePlusNewBase.execution,
            currentDecision: buildLearningDecision(['workspace-cli', 'docx-read'])
          }
        })

        const unknownPlusNewBase = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请学习 unknown-skill 和 workspace-cli'
        })
        const unknownPlusNewState = await learningNode({
          ...unknownPlusNewBase,
          execution: {
            ...unknownPlusNewBase.execution,
            currentDecision: buildLearningDecision(['unknown-skill', 'workspace-cli'])
          }
        })

        const builtinOnlyBase = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请学习 history-recall'
        })
        const builtinOnlyState = await learningNode({
          ...builtinOnlyBase,
          execution: {
            ...builtinOnlyBase.execution,
            currentDecision: buildLearningDecision(['history-recall'])
          }
        })

        return {
          duplicatePlusNewState,
          unknownPlusNewState,
          builtinOnlyState
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.duplicatePlusNewState.execution.watchHint &&
            result.duplicatePlusNewState.execution.lastLearningOutcome?.loadedSkillIds.includes(
              'docx-read'
            ) &&
            result.duplicatePlusNewState.execution.lastLearningOutcome?.skippedDuplicateSkillIds.includes(
              'workspace-cli'
            ) &&
            result.duplicatePlusNewState.execution.lastLearningOutcome?.skippedUnknownSkillIds.length ===
              0 &&
            result.duplicatePlusNewState.skills.learnedSkillIds.includes('workspace-cli') &&
            result.duplicatePlusNewState.skills.learnedSkillIds.includes('docx-read') &&
            result.duplicatePlusNewState.memory.history.roundHistory.at(-1)?.execution.kind ===
              'learning',
          {
            name: 'learning-loads-new-skills-and-skips-duplicates',
            message: '当请求里既有重复 skill 又有新 skill 时，learning 应只加载新 skill，不发 watchHint。',
            data: {
              watchHint: result.duplicatePlusNewState.execution.watchHint,
              lastLearningOutcome: result.duplicatePlusNewState.execution.lastLearningOutcome,
              learnedSkillIds: result.duplicatePlusNewState.skills.learnedSkillIds,
              latestRound: result.duplicatePlusNewState.memory.history.roundHistory.at(-1)
            }
          }
        )

        runtime.assertThat(
          !result.unknownPlusNewState.execution.watchHint &&
            result.unknownPlusNewState.execution.lastLearningOutcome?.loadedSkillIds.includes(
              'workspace-cli'
            ) &&
            result.unknownPlusNewState.execution.lastLearningOutcome?.skippedUnknownSkillIds.includes(
              'unknown-skill'
            ) &&
            result.unknownPlusNewState.skills.learnedSkillIds.includes('workspace-cli'),
          {
            name: 'learning-loads-known-skills-and-skips-unknown',
            message: '当请求里既有未知 skill 又有新 skill 时，learning 应只加载已知 skill，不发 watchHint。',
            data: {
              watchHint: result.unknownPlusNewState.execution.watchHint,
              lastLearningOutcome: result.unknownPlusNewState.execution.lastLearningOutcome,
              learnedSkillIds: result.unknownPlusNewState.skills.learnedSkillIds
            }
          }
        )

        runtime.assertThat(
          result.builtinOnlyState.execution.watchHint?.code === 'learning_no_effect' &&
            result.builtinOnlyState.execution.lastLearningOutcome?.loadedSkillIds.length === 0 &&
            result.builtinOnlyState.execution.lastLearningOutcome?.skippedDuplicateSkillIds.includes(
              'history-recall'
            ) &&
            !result.builtinOnlyState.skills.learnedSkillIds.includes('history-recall'),
          {
            name: 'learning-does-not-learn-builtin-skills',
            message: 'builtin skill 应视为始终可用，而不是可学习的外置 skill。',
            data: {
              watchHint: result.builtinOnlyState.execution.watchHint,
              lastLearningOutcome: result.builtinOnlyState.execution.lastLearningOutcome,
              learnedSkillIds: result.builtinOnlyState.skills.learnedSkillIds
            }
          }
        )
      }
    })
  })
})

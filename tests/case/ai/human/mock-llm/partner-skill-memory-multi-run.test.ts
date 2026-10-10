import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  filterAiRunEventsByType
} from '../testUtils'
import type { ChatMessageLogRecord } from '../../../../../src/shared/types'

const PARTNER_ID = 'partner-skill-memory-multi-run'

const readLatestLearnedSkillIds = (records: ChatMessageLogRecord[]): string[] => {
  let learnedSkillIds: string[] = []
  for (const record of records) {
    const entry = record.entry
    if (entry.kind === 'annotation' && entry.eventType === 'skill_state_updated') {
      learnedSkillIds = [...entry.payload.learnedSkillIds]
    }
  }
  return learnedSkillIds
}

describe('ai human mock-llm backend', () => {
  it('partner-skill-memory-multi-run', async () => {
    await runBackendCase({
      caseId: 'partner-skill-memory-multi-run',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证同一伙伴跨 run 共享技能；在 25 上限下学满后 FIFO 淘汰，且被淘汰 skill 可再学回来。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const run1 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'pdf-read'],
                  summary: '学习 Word 和 PDF 阅读技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第一轮完成。',
                  deliveryMarkdown: '第一轮完成。'
                })
              }
            ]
          }
        })
        await run1.run({ taskId: 'partner-skills-run-1', userInput: '学习文档技能。' })
        const stateAfterRun1 = readLatestLearnedSkillIds(
          await runtime.storageService.chatMessageLog.list(PARTNER_ID)
        )

        const run2 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['excel-write'],
                  summary: '补充 Excel 编辑技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第二轮完成。',
                  deliveryMarkdown: '第二轮完成。'
                })
              }
            ]
          }
        })
        await run2.run({ taskId: 'partner-skills-run-2', userInput: '继续使用伙伴技能。' })

        const run3 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['ppt-read', 'ppt-write'],
                  summary: '学习 PPT 阅读和编辑技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第三轮完成。',
                  deliveryMarkdown: '第三轮完成。'
                })
              }
            ]
          }
        })
        await run3.run({ taskId: 'partner-skills-run-3', userInput: '继续学习 PPT 技能。' })
        const stateAtLimit = readLatestLearnedSkillIds(
          await runtime.storageService.chatMessageLog.list(PARTNER_ID)
        )

        const eventOffsetBeforeRun4 = runtime.eventCollector.snapshot().length
        const run4 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['excel-read', 'image-generation', 'docx-write'],
                  summary: '补充 Excel 阅读与图片、Word 编辑技能并触发 FIFO 淘汰。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第四轮完成。',
                  deliveryMarkdown: '第四轮完成。'
                })
              }
            ]
          }
        })
        await run4.run({ taskId: 'partner-skills-run-4', userInput: '检查遗忘结果。' })
        const stateAfterEviction = readLatestLearnedSkillIds(
          await runtime.storageService.chatMessageLog.list(PARTNER_ID)
        )
        const run4LearningSteps = filterAiRunEventsByType(
          runtime.eventCollector.snapshot().slice(eventOffsetBeforeRun4),
          'human_step'
        ).filter((event) => event.stage === 'human_learning')
        const run4EvictionSummary = run4LearningSteps.find((event) =>
          event.summary.includes('已淘汰最早学习的 skill=')
        )?.summary

        const eventOffsetBeforeRun5 = runtime.eventCollector.snapshot().length
        const run5 = createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '被淘汰后重新学习 Word 阅读技能。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '第五轮完成。',
                  deliveryMarkdown: '第五轮完成。'
                })
              }
            ]
          }
        })
        await run5.run({
          taskId: 'partner-skills-run-5',
          userInput: '重新学习被淘汰的 Word 阅读技能。'
        })
        const stateAfterRelearn = readLatestLearnedSkillIds(
          await runtime.storageService.chatMessageLog.list(PARTNER_ID)
        )
        const run5LearningSteps = filterAiRunEventsByType(
          runtime.eventCollector.snapshot().slice(eventOffsetBeforeRun5),
          'human_step'
        ).filter((event) => event.stage === 'human_learning')

        return {
          stateAfterRun1,
          stateAtLimit,
          stateAfterEviction,
          stateAfterRelearn,
          run4EvictionSummary,
          run5LoadedDocxRead: run5LearningSteps.some(
            (event) =>
              event.learnedSkillIds.includes('docx-read') &&
              event.summary.includes('learning 已加载 docx-read')
          )
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.stateAfterRun1.join(',') === 'docx-read,pdf-read' &&
            result.stateAtLimit.includes('ppt-read') &&
            result.stateAtLimit.includes('ppt-write') &&
            Boolean(result.run4EvictionSummary?.includes('pdf-read')) &&
            ['excel-read', 'image-generation', 'docx-write'].every((skill) =>
              result.stateAfterEviction.includes(skill)
            ) &&
            !result.stateAfterEviction.includes('docx-read') &&
            !result.stateAfterEviction.includes('pdf-read') &&
            result.run5LoadedDocxRead &&
            result.stateAfterRelearn.includes('docx-read'),
          {
            name: 'partner-skills-persist-evict-and-relearn-under-tool-budget',
            message:
              '同一伙伴应跨 run 共享技能；学满 25 上限后 FIFO 淘汰最早 skill，被淘汰 skill 应可再学回来。',
            data: result
          }
        )
      }
    })
  })
})

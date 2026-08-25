import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('learning-tool-budget-tracking', async () => {
    await runBackendCase({
      caseId: 'learning-tool-budget-tracking',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 learning 会持续记录 active tool 数，并在预算未超限时保留当前已学习 skill。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-write'],
                  summary: '再学习 docx 写入'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['terminal', 'kb-retrieval'],
                  summary: '故意请求 builtin skill'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已观察到 learning 的 active tool 预算统计。',
                  deliveryMarkdown: '# Learning Budget\n\n已验证 learning 的 active tool 预算统计。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请多轮学习 skill，并验证 active tool 预算裁剪。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const learningSteps = filterAiRunEventsByType(result.events, 'human_step').filter(
          (event) => event.stage === 'human_learning'
        )
        const latestLearningStep = learningSteps.at(-1)

        runtime.assertThat(
          result.output.status === 'completed' &&
            latestLearningStep?.learnedSkillIds.join(',') === 'docx-read,docx-write' &&
            latestLearningStep?.effectiveSkillIds.includes('terminal') &&
            latestLearningStep?.effectiveSkillIds.includes('kb-retrieval') &&
            latestLearningStep.availableToolNames.includes('terminal_run') &&
            latestLearningStep.availableToolNames.includes('kb_list_documents') &&
            latestLearningStep.availableToolNames.includes('kb_search') &&
            latestLearningStep.availableToolNames.includes('docx_read_outline') &&
            latestLearningStep.availableToolNames.includes('docx_search') &&
            latestLearningStep.availableToolNames.includes('docx_read_blocks') &&
            latestLearningStep.availableToolNames.includes('docx_read_visuals') &&
            latestLearningStep.availableToolNames.includes('docx_edit') &&
            latestLearningStep.summary.includes('当前 active tools=') &&
            !latestLearningStep.summary.includes('已淘汰最早学习的 skill='),
          {
            name: 'learning-tracks-active-tool-count-under-budget',
            message:
              'learning 在预算未超限时应保留当前 skill，并把 active tool 数反映到 learning summary 中。',
            data: {
              learnedSkillIds: latestLearningStep?.learnedSkillIds,
              effectiveSkillIds: latestLearningStep?.effectiveSkillIds,
              availableToolNames: latestLearningStep?.availableToolNames,
              summary: latestLearningStep?.summary
            }
          }
        )
      }
    })
  })
})

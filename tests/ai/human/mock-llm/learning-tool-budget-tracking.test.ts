import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
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
      description: '验证 learning 会持续记录 active tool 数，并在预算未超限时保留当前已学习 skill。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli', 'docx-read'],
                  summary: '先学习 terminal 和 docx-read',
                  reason: '准备让后续可用工具逼近预算上限。',
                  expectedOutcome: '获得 6 个活跃工具。'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-write'],
                  summary: '再学习 docx 写入',
                  reason: '继续扩大当前活跃工具集合。',
                  expectedOutcome: '获得 8 个活跃工具。'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['kb-document-discovery', 'kb-evidence-query'],
                  summary: '学习 kb 相关技能',
                  reason: '继续扩大当前活跃工具集合，并验证预算统计会保持准确。',
                  expectedOutcome: '把当前 active tools 扩展到 12，并保持所有已学习 skill 可用。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已观察到 learning 的 active tool 预算统计。',
                  reason: '学习链路已经满足测试目标。',
                  expectedOutcome: '结束任务。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已观察到 learning 的 active tool 预算统计。',
                  deliveryMarkdown: '# Learning Budget\n\n已验证 learning 的 active tool 预算统计。'
                }
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
            latestLearningStep?.learnedSkillIds.join(',') ===
              'workspace-cli,docx-read,docx-write,kb-document-discovery,kb-evidence-query' &&
            latestLearningStep?.effectiveSkillIds.includes('history-recall') &&
            latestLearningStep.availableToolNames.includes('history_recall') &&
            latestLearningStep.availableToolNames.length === 13 &&
            latestLearningStep.summary.includes('当前 active tools=12') &&
            !latestLearningStep.summary.includes('已淘汰最早学习的 skill='),
          {
            name: 'learning-tracks-active-tool-count-under-budget',
            message: 'learning 在预算未超限时应保留当前 skill，并把 active tool 数反映到 learning summary 中。',
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

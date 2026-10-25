import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision,
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
        '验证 toolset_loading 会持续记录 active tool 数，并在预算未超限时保留当前已学习 toolset。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['docx-read'],
                  summary: '先学习 docx-read'
                })
              },
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['docx-write'],
                  summary: '再学习 DOCX 写入技能'
                })
              },
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['terminal', 'kb-retrieval'],
                  summary: '故意请求 builtin toolset'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已观察到 toolset_loading 的 active tool 预算统计。',
                  deliveryMarkdown:
                    '# ToolsetLoading Budget\n\n已验证 toolset_loading 的 active tool 预算统计。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请多轮学习 toolset，并验证 active tool 预算裁剪。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolsetLoadingSteps = filterAiRunEventsByType(result.events, 'human_step').filter(
          (event) => event.stage === 'human_toolset_loading'
        )
        const latestToolsetLoadingStep = toolsetLoadingSteps.at(-1)

        runtime.assertThat(
          result.output.status === 'completed' &&
            latestToolsetLoadingStep?.loadedToolsetIds.join(',') === 'docx-read,docx-write' &&
            latestToolsetLoadingStep?.effectiveToolsetIds.includes('terminal') &&
            latestToolsetLoadingStep?.effectiveToolsetIds.includes('kb-retrieval') &&
            latestToolsetLoadingStep.availableToolNames.includes('terminal_run') &&
            latestToolsetLoadingStep.availableToolNames.includes('kb_list_documents') &&
            latestToolsetLoadingStep.availableToolNames.includes('kb_search') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_read_outline') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_search') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_read_nodes') &&
            latestToolsetLoadingStep.availableToolNames.includes('read_image') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_content_edit') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_format') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_table_edit') &&
            latestToolsetLoadingStep.availableToolNames.includes('docx_comments_revisions') &&
            latestToolsetLoadingStep.summary.includes('当前 active tools=') &&
            !latestToolsetLoadingStep.summary.includes('已淘汰最早加载的 toolset='),
          {
            name: 'toolset_loading-tracks-active-tool-count-under-budget',
            message:
              'toolset_loading 在预算未超限时应保留当前 toolset，并把 active tool 数反映到 toolset_loading summary 中。',
            data: {
              loadedToolsetIds: latestToolsetLoadingStep?.loadedToolsetIds,
              effectiveToolsetIds: latestToolsetLoadingStep?.effectiveToolsetIds,
              availableToolNames: latestToolsetLoadingStep?.availableToolNames,
              summary: latestToolsetLoadingStep?.summary
            }
          }
        )
      }
    })
  })
})

import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxApplyOpsResult, DocxOpenResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('complex-docx-edit', async () => {
    await runBackendCase({
      caseId: 'complex-docx-edit',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下 human 仍通过真实 docx 工具链完成打开、编辑和搜索。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'complex-edit.docx', [
          {
            type: 'paragraph',
            text: 'Cycle 1 draft content.'
          },
          {
            type: 'paragraph',
            text: 'Keep original note.'
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'docx-write', 'docx-delivery'],
                  summary: '先学习 docx 相关 skill',
                  reason: '需要用真实 docx 工具完成编辑流程。',
                  expectedOutcome: '获得 docx 工具族。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_open',
                  args: {
                    sourcePath: 'complex-edit.docx'
                  },
                  summary: '打开原始文档',
                  reason: '必须先打开文档，才能进入编辑。',
                  expectedOutcome: '拿到 docId。'
                })
              },
              () => {
                const openResult = readLatestToolResultDataFromEvents<DocxOpenResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_open'
                )
                return buildToolDecision({
                  toolName: 'docx_apply_ops',
                  args: {
                    docId: openResult.docId,
                    ops: [
                      {
                        type: 'replace_text',
                        query: 'Cycle 1 draft content.',
                        replace: 'Cycle 3 cumulative draft content.'
                      }
                    ]
                  },
                  summary: '在真实 docx 上执行编辑',
                  reason: '验证真实写工具链路。',
                  expectedOutcome: '生成 newDocId 和 changedBlocks。'
                })
              },
              () => {
                const applyResult = readLatestToolResultDataFromEvents<DocxApplyOpsResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_apply_ops'
                )
                return buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    docId: applyResult.newDocId,
                    query: 'Cycle 3 cumulative draft content.',
                    mode: 'literal'
                  },
                  summary: '搜索新内容',
                  reason: '验证编辑结果已经真实进入后续 docx session。',
                  expectedOutcome: '确认新文本可被搜索到。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'docx 真实链路已走通。',
                  reason: '打开、编辑、搜索三步都已经完成。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'docx 真实链路已走通。',
                  deliveryMarkdown: '# Docx Flow\n\n已完成真实 docx 打开、编辑与搜索。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请打开文档，修改内容，然后确认新内容可搜索到。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const applyResult = readLatestToolResultDataFromEvents<DocxApplyOpsResult>(
          toolResults,
          'docx_apply_ops'
        )
        const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
          toolResults,
          'docx_search'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            applyResult.changedBlocks.length === 1 &&
            searchResult.matches.length === 1,
          {
            name: 'human-docx-edit-uses-real-docx-production-chain',
            message: 'mock-llm 下的 human/docx case 应通过真实 docx 工具链完成编辑并搜索到新内容。',
            data: {
              applyResult,
              searchResult
            }
          }
        )
      }
    })
  })
})

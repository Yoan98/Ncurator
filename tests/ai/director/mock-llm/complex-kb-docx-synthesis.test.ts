import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxApplyOpsResult, DocxOpenResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../../human/testUtils'

describe('ai director mock-llm backend', () => {
  it('complex-kb-docx-synthesis', async () => {
    await runBackendCase({
      caseId: 'complex-kb-docx-synthesis',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在 mock-llm 模式下仍会通过真实 human 跑通 KB、docx 与 synthesis 组合链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedKb([
          {
            id: 'doc-1',
            name: 'Risk Playbook.md',
            chunks: [
              {
                id: 'chunk-1',
                text: '审批被拒绝时必须保留现有文件不变。'
              }
            ]
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'plan-docx.docx', [
          {
            type: 'paragraph',
            text: 'Initial draft for director plan.'
          }
        ])

        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'to_plan',
                  reason: '需要分别完成 KB 检索和 docx 编辑。'
                }
              }
            ],
            'director.plan': [
              {
                output: {
                  tasks: [
                    {
                      id: 'task-kb',
                      title: 'KB Task',
                      userInput: '请先从 KB 中找出审批被拒绝时的处理要求。'
                    },
                    {
                      id: 'task-docx',
                      title: 'Docx Task',
                      userInput: '请再修改 docx 草稿中的正文。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['kb-document-discovery', 'kb-evidence-query'],
                  summary: '为 task-kb 学习 KB skill',
                  reason: '需要执行真实 KB 搜索。',
                  expectedOutcome: '获得 KB 工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'kb_fts_search_chunks',
                  args: {
                    queryText: '审批被拒绝 保留现有文件',
                    limit: 5
                  },
                  summary: '执行真实 KB 搜索',
                  reason: '获取 task-kb 的证据。',
                  expectedOutcome: '拿到 KB 检索结果。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-kb 已完成。',
                  reason: 'KB 证据已拿到。',
                  expectedOutcome: '交回 task handoff。'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'docx-write'],
                  summary: '为 task-docx 学习 docx skill',
                  reason: '需要执行真实 docx 编辑。',
                  expectedOutcome: '获得 docx 工具。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_open',
                  args: {
                    sourcePath: 'plan-docx.docx'
                  },
                  summary: '打开 docx 草稿',
                  reason: '必须先打开文档。',
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
                        query: 'Initial draft for director plan.',
                        replace: 'Updated draft for director synthesis.'
                      }
                    ]
                  },
                  summary: '修改 docx 正文',
                  reason: '验证真实 docx 编辑。',
                  expectedOutcome: '产生 changedBlocks。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-docx 已完成。',
                  reason: 'docx 编辑已完成。',
                  expectedOutcome: '交回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'complex synthesis 已完成。',
                  reason: 'KB 与 docx 两个子任务都已完成。',
                  expectedOutcome: '输出最终综合结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'task-kb 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-kb 已完成。\n\n## 已确认信息\n- 审批被拒绝时必须保留现有文件不变。\n\n## 关键证据\n- 来自真实 KB 检索结果。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可继续执行 docx 编辑。\n\n## 建议下一步\n- 进入 task-docx。'
                }
              },
              {
                output: {
                  summary: 'task-docx 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-docx 已完成。\n\n## 已确认信息\n- Docx 草稿正文已更新。\n\n## 关键证据\n- 通过真实 docx_open + docx_apply_ops 完成修改。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可直接综合输出。\n\n## 建议下一步\n- 进入 synthesis。'
                }
              },
              {
                output: {
                  summary: 'complex synthesis 已完成。',
                  deliveryMarkdown: '# Final Answer\n\n已综合真实 KB 结果与真实 docx 编辑结果完成最终输出。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请先查 KB，再修改 docx，最后综合输出。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const humanToolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const kbResult = readLatestToolResultDataFromEvents<Array<{ document_id?: string; text: string }>>(
          humanToolResults,
          'kb_fts_search_chunks'
        )
        const docxApplyResult = readLatestToolResultDataFromEvents<DocxApplyOpsResult>(
          humanToolResults,
          'docx_apply_ops'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            kbResult.some((row) => row.document_id === 'doc-1') &&
            docxApplyResult.changedBlocks.length === 1,
          {
            name: 'director-complex-path-uses-real-kb-and-docx-via-real-human',
            message: 'complex director case 应通过真实 human 子任务跑通 KB 检索、docx 编辑与 synthesis。',
            data: {
              kbResult,
              docxApplyResult,
              finalDeliveryMarkdown: result.state.finalDeliveryMarkdown
            }
          }
        )
      }
    })
  }, 600_000)
})

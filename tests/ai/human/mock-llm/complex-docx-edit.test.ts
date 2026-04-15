import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxApplyOpsResult, DocxOpenResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  collectDocxApplyOpsContentKinds,
  filterAiRunEventsByType,
  readLatestToolResultDataFromEvents
} from '../testUtils'
import { findParagraphBlockIdByText, type DocxOutlineResult } from '../../tool/docx/testUtils'

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
                  skillIds: ['docx-read', 'docx-write'],
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
                  expectedOutcome: '初始化文档会话并获得当前版本。'
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
                    sourcePath: openResult.sourcePath,
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
                  expectedOutcome: '生成新版本并返回 changedBlocks。'
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
                    sourcePath: applyResult.sourcePath,
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
  }, 15_000)

  it('complex-docx-insert-structured-content', async () => {
    await runBackendCase({
      caseId: 'complex-docx-insert-structured-content',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下 human 可以提交 paragraph/table 结构化 docx_apply_ops 参数。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'complex-structured-edit.docx', [
          {
            type: 'heading',
            text: '图形学',
            level: 1
          },
          {
            type: 'paragraph',
            text: '达到反走样。'
          },
          {
            type: 'paragraph',
            text: '结尾段落。'
          }
        ])

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read', 'docx-write'],
                  summary: '先学习 docx 读写能力',
                  reason: '需要读取锚点并写入结构化内容。',
                  expectedOutcome: '获得 docx 工具族。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_open',
                  args: {
                    sourcePath: 'complex-structured-edit.docx'
                  },
                  summary: '打开原始文档',
                  reason: '必须先初始化 docx 会话。',
                  expectedOutcome: '拿到 sourcePath 与当前版本。'
                })
              },
              () => {
                const openResult = readLatestToolResultDataFromEvents<DocxOpenResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_open'
                )
                return buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: openResult.sourcePath,
                    includeTables: true,
                    includeCells: true,
                    maxBlocks: 60
                  },
                  summary: '读取结构提纲',
                  reason: '需要先定位反走样段落的锚点 blockId。',
                  expectedOutcome: '拿到可插入的 anchorBlockId。'
                })
              },
              () => {
                const outlineResult = readLatestToolResultDataFromEvents<DocxOutlineResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_outline'
                )
                const openResult = readLatestToolResultDataFromEvents<DocxOpenResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_open'
                )
                const anchorBlockId = findParagraphBlockIdByText(
                  outlineResult.blocks,
                  '达到反走样。'
                )
                return buildToolDecision({
                  toolName: 'docx_apply_ops',
                  args: {
                    sourcePath: openResult.sourcePath,
                    ops: [
                      {
                        type: 'insert_after',
                        anchorBlockId,
                        content: [
                          {
                            kind: 'paragraph',
                            runs: [
                              {
                                text: '补充说明：反走样通过平滑边缘像素来减轻锯齿感。'
                              }
                            ]
                          },
                          {
                            kind: 'table',
                            rows: [
                              [
                                {
                                  paragraphs: [
                                    {
                                      kind: 'paragraph',
                                      runs: [{ text: '反走样' }]
                                    }
                                  ]
                                },
                                {
                                  paragraphs: [
                                    {
                                      kind: 'paragraph',
                                      runs: [{ text: '过拟合' }]
                                    }
                                  ]
                                }
                              ],
                              [
                                {
                                  paragraphs: [
                                    {
                                      kind: 'paragraph',
                                      runs: [{ text: '平滑边缘，降低锯齿' }]
                                    }
                                  ]
                                },
                                {
                                  paragraphs: [
                                    {
                                      kind: 'paragraph',
                                      runs: [{ text: '记住训练噪声，泛化变差' }]
                                    }
                                  ]
                                }
                              ]
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  summary: '插入结构化说明与表格',
                  reason: '验证 human 能提交合法的 paragraph/table 结构。',
                  expectedOutcome: '生成包含新增段落与表格的新版本。'
                })
              },
              () => {
                const applyResult = readLatestToolResultDataFromEvents<DocxApplyOpsResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_apply_ops'
                )
                return buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: applyResult.sourcePath,
                    includeTables: true,
                    includeCells: true,
                    maxBlocks: 80
                  },
                  summary: '复查新版本结构',
                  reason: '确认新增段落与表格已经进入文档结构。',
                  expectedOutcome: 'outline 中出现 paragraph 与 table。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '结构化 docx 写入已完成。',
                  reason: '已完成打开、定位、结构化写入和复查。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '结构化 docx 写入已完成。',
                  deliveryMarkdown: '# Structured Docx Flow\n\n已完成 paragraph/table 结构化写入。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请在文档里插入补充说明和一个简单表格。'
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
        const outlineResult = readLatestToolResultDataFromEvents<DocxOutlineResult>(
          toolResults,
          'docx_outline'
        )
        const contentKinds = collectDocxApplyOpsContentKinds(result.events)

        runtime.assertThat(
          applyResult.changedBlocks.some((block) => block.action === 'insert_after') &&
            contentKinds.includes('paragraph') &&
            contentKinds.includes('table') &&
            outlineResult.blocks.some(
              (block) =>
                block.type === 'paragraph' &&
                block.text.includes('补充说明：反走样通过平滑边缘像素来减轻锯齿感。')
            ) &&
            outlineResult.blocks.some((block) => block.type === 'table'),
          {
            name: 'human-docx-structured-insert-uses-legal-docx-shape',
            message:
              'mock-llm 下的 human/docx case 应提交 paragraph/table 结构化 docx_apply_ops 参数并成功写入文档。',
            data: {
              applyResult,
              outlineResult,
              contentKinds
            }
          }
        )
      }
    })
  }, 15_000)
})

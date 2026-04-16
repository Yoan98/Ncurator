import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxReadResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  collectDocxApplyOpsContentKinds,
  filterAiRunEventsByType,
  hasDraftFileArtifact,
  hasDraftReviewArtifact,
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
      description: '验证 mock-llm 模式下 human 仍通过真实 docx 工具链完成读取、编辑和读回确认。',
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
                  toolName: 'docx_text_edit',
                  args: {
                    sourcePath: 'complex-edit.docx',
                    query: 'Cycle 1 draft content.',
                    replace: 'Cycle 3 cumulative draft content.'
                  },
                  summary: '在真实 docx 上执行编辑',
                  reason: '验证真实写工具链路。',
                  expectedOutcome: '生成新版本并返回 changedBlocks。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_search',
                  args: {
                    sourcePath: 'complex-edit.docx',
                    query: 'Cycle 3 cumulative draft content.'
                  },
                  summary: '搜索新内容',
                  reason: '先定位编辑后的 block，再继续精读。',
                  expectedOutcome: '确认新文本可被搜索到。'
                })
              },
              () => {
                const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_search'
                )
                return buildToolDecision({
                  toolName: 'docx_read',
                  args: {
                    sourcePath: 'complex-edit.docx',
                    fromBlockId: searchResult.matches[0]!.blockId
                  },
                  summary: '精读新内容',
                  reason: '验证编辑结果已经真实进入后续 docx session。',
                  expectedOutcome: '确认新文本可被精读到。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'docx 真实链路已走通。',
                  reason: '编辑与读回确认都已经完成。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'docx 真实链路已走通。',
                  deliveryMarkdown: '# Docx Flow\n\n已完成真实 docx 编辑与读取确认。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请修改内容，然后确认新内容可读取到。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const applyResult = readLatestToolResultDataFromEvents<DocxMutationResult>(
          toolResults,
          'docx_text_edit'
        )
        const searchResult = readLatestToolResultDataFromEvents<DocxSearchResult>(
          toolResults,
          'docx_search'
        )
        const readResult = readLatestToolResultDataFromEvents<DocxReadResult>(
          toolResults,
          'docx_read'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            applyResult.changedBlocks.length === 1 &&
            searchResult.matches.length === 1 &&
            readResult.blocks.length === 1 &&
            hasDraftReviewArtifact(result.output.artifacts) &&
            hasDraftFileArtifact(result.output.artifacts) &&
            filterAiRunEventsByType(result.events, 'draft_review_ready').length === 1,
          {
            name: 'human-docx-edit-uses-real-docx-production-chain',
            message:
              'mock-llm 下的 human/docx case 应通过真实 docx 工具链完成编辑、读回确认并产出 draft review artifact。',
            data: {
              applyResult,
              searchResult,
              readResult,
              artifacts: result.output.artifacts
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
      description: '验证 mock-llm 模式下 human 可以按对象类型提交段落与表格编辑参数。',
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
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: 'complex-structured-edit.docx',
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
                const anchorBlockId = findParagraphBlockIdByText(
                  outlineResult.blocks,
                  '达到反走样。'
                )
                return buildToolDecision({
                  toolName: 'docx_paragraph_edit',
                  args: {
                    sourcePath: 'complex-structured-edit.docx',
                    action: 'insert_after',
                    anchorBlockId,
                    text: '补充说明：反走样通过平滑边缘像素来减轻锯齿感。'
                  },
                  summary: '插入补充说明',
                  reason: '先插入段落说明，后续再接表格。',
                  expectedOutcome: '生成新增段落并返回 createdBlocks。'
                })
              },
              () => {
                const paragraphEditResult = readLatestToolResultDataFromEvents<DocxMutationResult>(
                  runtime.eventCollector.snapshot(),
                  'docx_paragraph_edit'
                )
                const anchorBlockId = paragraphEditResult.createdBlocks?.[0]?.blockId
                if (!anchorBlockId) {
                  throw new Error('paragraph edit did not return createdBlocks')
                }
                return buildToolDecision({
                  toolName: 'docx_table_edit',
                  args: {
                    sourcePath: 'complex-structured-edit.docx',
                    action: 'insert_after',
                    anchorBlockId,
                    rows: [
                      ['反走样', '过拟合'],
                      ['平滑边缘，降低锯齿', '记住训练噪声，泛化变差']
                    ]
                  },
                  summary: '插入对照表',
                  reason: '验证 human 能提交合法的表格对象参数。',
                  expectedOutcome: '生成包含新增表格的新版本。'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: 'complex-structured-edit.docx',
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
                  reason: '已完成定位、段落写入、表格写入和复查。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '结构化 docx 写入已完成。',
                  deliveryMarkdown: '# Structured Docx Flow\n\n已完成 paragraph/table 对象化写入。'
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
        const paragraphEditResult = readLatestToolResultDataFromEvents<DocxMutationResult>(
          toolResults,
          'docx_paragraph_edit'
        )
        const tableEditResult = readLatestToolResultDataFromEvents<DocxMutationResult>(
          toolResults,
          'docx_table_edit'
        )
        const outlineResult = readLatestToolResultDataFromEvents<DocxOutlineResult>(
          toolResults,
          'docx_outline'
        )
        const contentKinds = collectDocxApplyOpsContentKinds(result.events)

        runtime.assertThat(
          paragraphEditResult.changedBlocks.some((block) => block.action === 'insert_after') &&
            tableEditResult.changedBlocks.some((block) => block.action === 'insert_after') &&
            contentKinds.includes('paragraph') &&
            contentKinds.includes('table') &&
            hasDraftReviewArtifact(result.output.artifacts) &&
            hasDraftFileArtifact(result.output.artifacts) &&
            outlineResult.blocks.some(
              (block) =>
                block.type === 'paragraph' &&
                block.preview.includes('补充说明：反走样通过平滑边缘像素来减轻锯齿感。')
            ) &&
            outlineResult.blocks.some((block) => block.type === 'table'),
          {
            name: 'human-docx-structured-insert-uses-legal-docx-shape',
            message:
              'mock-llm 下的 human/docx case 应提交 paragraph/table 对象化参数、成功写入文档并产出 confirm copy artifact。',
            data: {
              paragraphEditResult,
              tableEditResult,
              outlineResult,
              contentKinds,
              artifacts: result.output.artifacts
            }
          }
        )
      }
    })
  }, 15_000)
})

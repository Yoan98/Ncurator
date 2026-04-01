import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxApplyOpsResult, DocxOpenResult, DocxSearchResult } from '../../tool/docx/testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const readLatestToolResultData = <TResult>(input: {
  events: ReturnType<typeof filterAiRunEventsByType>
  toolName: string
}): TResult => {
  const matched = input.events
    .filter((event) => event.toolName === input.toolName)
    .at(-1)
  if (!matched?.result?.data) {
    throw new Error(`tool result data missing for ${input.toolName}`)
  }
  return matched.result.data as TResult
}

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
                const events = filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'tool_call_result')
                const openResult = readLatestToolResultData<DocxOpenResult>({
                  events,
                  toolName: 'docx_open'
                })
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
                const events = filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'tool_call_result')
                const applyResult = readLatestToolResultData<DocxApplyOpsResult>({
                  events,
                  toolName: 'docx_apply_ops'
                })
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
        const applyResult = readLatestToolResultData<DocxApplyOpsResult>({
          events: toolResults,
          toolName: 'docx_apply_ops'
        })
        const searchResult = readLatestToolResultData<DocxSearchResult>({
          events: toolResults,
          toolName: 'docx_search'
        })

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

  it('multi-tool-collaboration', async () => {
    await runBackendCase({
      caseId: 'multi-tool-collaboration',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下 human 会通过真实 hand 并行执行多工具协作。',
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

        const runner = createHumanTestRunner(runtime, {
          selectedDocumentIds: ['doc-1'],
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['workspace-cli', 'kb-document-discovery'],
                  summary: '先学习 terminal 与 KB skill',
                  reason: '需要并行拿到工作区与资料列表信息。',
                  expectedOutcome: '获得两个工具家族。'
                })
              },
              {
                output: {
                  memoryOps: [],
                  decision: {
                    summary: '并行执行 terminal 与 KB 工具',
                    reason: '两个动作都属于只读且可以并行。',
                    expectedOutcome: '一次 hand 同时拿到工作区路径和资料范围。'
                  },
                  nextAction: {
                    action: 'hand',
                    parallelCallToolParam: [
                      {
                        toolName: 'terminal_run_command',
                        args: {
                          command: 'pwd'
                        }
                      },
                      {
                        toolName: 'kb_list_documents',
                        args: {}
                      }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '多工具协作已完成。',
                  reason: '并行工具调用已经带回结果。',
                  expectedOutcome: '进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '多工具协作已完成。',
                  deliveryMarkdown: '# Multi Tool\n\n已完成真实并行工具协作。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请并行读取工作区路径并列出知识库文档。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const toolNames = toolResults.map((event) => event.toolName)

        runtime.assertThat(
          result.output.status === 'completed' &&
            toolNames.includes('terminal_run_command') &&
            toolNames.includes('kb_list_documents'),
          {
            name: 'human-can-execute-real-parallel-multi-tool-batch',
            message: 'human 应通过真实 hand 节点执行一次并行多工具协作。',
            data: {
              toolNames
            }
          }
        )
      }
    })
  })

  it('kb-answer-with-real-kb', async () => {
    await runBackendCase({
      caseId: 'kb-answer-with-real-kb',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 mock-llm 模式下 human 的 KB 回答仍通过真实 KB 存储、embedding 与检索代码执行。',
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
          },
          {
            id: 'doc-2',
            name: 'Owner Notes.md',
            chunks: [
              {
                id: 'chunk-2',
                text: '风险 owner 当前是运营负责人 Alice。'
              }
            ]
          }
        ])

        let mouthPrompt = ''
        const runner = createHumanTestRunner(runtime, {
          selectedDocumentIds: ['doc-1', 'doc-2'],
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['kb-document-discovery', 'kb-evidence-query'],
                  summary: '先学习 KB skill',
                  reason: '任务要求直接基于知识库回答。',
                  expectedOutcome: '获得检索工具。'
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
                  reason: '需要先从真实知识库中找到证据。',
                  expectedOutcome: '拿到匹配 chunk。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已拿到 KB 证据。',
                  reason: '已有足够证据可进入最终回答。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              ({ user }) => {
                mouthPrompt = user
                return {
                  summary: '已拿到 KB 证据。',
                  deliveryMarkdown: '# KB Answer\n\n审批被拒绝时应保留现有文件不变。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请根据当前知识库说明审批被拒绝时应如何处理现有文件。'
        })

        return {
          output,
          mouthPrompt,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const kbResult = readLatestToolResultData<Array<{ document_id?: string; text: string }>>({
          events: toolResults,
          toolName: 'kb_fts_search_chunks'
        })

        runtime.assertThat(
          result.output.status === 'completed' &&
            kbResult.some((row) => row.document_id === 'doc-1') &&
            result.mouthPrompt.includes('审批被拒绝时必须保留现有文件不变'),
          {
            name: 'human-kb-answer-uses-real-kb-runtime',
            message: 'KB 回答 case 应通过真实 KB 检索拿到证据，并把证据带入真实 mouth prompt。',
            data: {
              kbResult,
              mouthPrompt: result.mouthPrompt
            }
          }
        )
      }
    })
  })
})

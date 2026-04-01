import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxApplyOpsResult, DocxOpenResult } from '../../tool/docx/testUtils'
import {
  filterDirectorEventsByType,
  filterDirectorTaskEventsByStage
} from '../testUtils'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../../human/testUtils'

const readLatestHumanToolResultData = <TResult>(input: {
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

describe('ai director mock-llm backend', () => {
  it('plan-exec-then-synthesis', async () => {
    await runBackendCase({
      caseId: 'plan-exec-then-synthesis',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在 mock-llm 模式下会通过真实 human 逐步执行 plan，然后进入 synthesis。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'to_plan',
                  reason: '当前任务适合拆解为多个子任务。'
                }
              }
            ],
            'director.plan': [
              {
                output: {
                  tasks: [
                    {
                      id: 'task-1',
                      title: 'Collect facts',
                      userInput: '请先整理第一部分事实。'
                    },
                    {
                      id: 'task-2',
                      title: 'Summarize risks',
                      userInput: '请再整理第二部分风险。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-1 已完成。',
                  reason: '第一阶段只需直接整理结果。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task-2 已完成。',
                  reason: '第二阶段只需直接整理结果。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合输出已完成。',
                  reason: '所有 plan task 都已完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'task-1 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-1 已完成。\n\n## 已确认信息\n- 第一部分事实已整理。\n\n## 关键证据\n- 当前阶段无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可继续执行 task-2。\n\n## 建议下一步\n- 进入下一个 plan task。'
                }
              },
              {
                output: {
                  summary: 'task-2 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask-2 已完成。\n\n## 已确认信息\n- 第二部分风险已整理。\n\n## 关键证据\n- 当前阶段无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可进入 synthesis。\n\n## 建议下一步\n- 进行综合输出。'
                }
              },
              {
                output: {
                  summary: '综合输出已完成。',
                  deliveryMarkdown: '# Final Answer\n\n已完成 plan 执行和最终综合输出。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请拆解任务并逐步完成。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const planCreated = filterDirectorEventsByType(result.events, 'plan_created')
        const planExecStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_plan_exec'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            result.state.plan.every((task) => task.status === 'completed') &&
            planCreated.length === 1 &&
            planExecStarts.length === 2 &&
            result.state.finalDeliveryMarkdown?.includes('plan 执行') === true,
          {
            name: 'director-plan-exec-and-synthesis-run-through-real-human',
            message: 'director 应通过真实 human 逐项执行计划任务，再进入 synthesis 完成最终输出。',
            data: {
              plan: result.state.plan,
              finalDeliveryMarkdown: result.state.finalDeliveryMarkdown
            }
          }
        )
      }
    })
  })

  it('context-evidence-reuse', async () => {
    await runBackendCase({
      caseId: 'context-evidence-reuse',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证真实 context human 产出的可复用证据会被带入后续 director 计划 prompt。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let plannerSeesContextEvidence = false
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'need_context',
                  reason: '先补充上下文。'
                }
              },
              {
                output: {
                  mode: 'to_plan',
                  reason: '上下文已经足够，可以规划任务。'
                }
              }
            ],
            'director.plan': [
              ({ user }) => {
                plannerSeesContextEvidence = user.includes('Alice owns the risk')
                return {
                  tasks: [
                    {
                      id: 'task-1',
                      title: 'Reuse evidence',
                      userInput: '请继续使用已有 evidence 推进。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成上下文补充。',
                  reason: '先产出可复用 context note。',
                  expectedOutcome: '把 reusable evidence 交回 director。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'task 已完成。',
                  reason: '计划任务不需要额外动作。',
                  expectedOutcome: '返回 task handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合输出完成。',
                  reason: '计划任务已经完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '已完成上下文补充。',
                  deliveryMarkdown:
                    '# 上下文补充结果\n\n## 本轮结论\n已补充当前上下文。\n\n## 可复用证据\n- Alice owns the risk\n\n## 当前边界\n- 暂无其他限制。\n\n## 未决项\n无\n\n## 建议补充方向\n- 可直接规划后续任务。'
                }
              },
              {
                output: {
                  summary: 'task 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\ntask 已完成。\n\n## 已确认信息\n- 已复用 context evidence。\n\n## 关键证据\n- Alice owns the risk\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可直接综合。\n\n## 建议下一步\n- 进入 synthesis。'
                }
              },
              {
                output: {
                  summary: '综合输出完成。',
                  deliveryMarkdown: '# Final Answer\n\n已复用 context evidence 完成任务。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请先补充上下文，再规划任务。'
        })

        return {
          state,
          plannerSeesContextEvidence
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.status === 'completed' && result.plannerSeesContextEvidence,
          {
            name: 'director-plan-prompt-reuses-context-human-evidence',
            message: 'context human 产出的 reusable evidence 应进入后续 director plan prompt。',
            data: {
              plannerSeesContextEvidence: result.plannerSeesContextEvidence,
              contextEvidence: result.state.contextEvidence
            }
          }
        )
      }
    })
  })

  it('plan-exec-serial-merge', async () => {
    await runBackendCase({
      caseId: 'plan-exec-serial-merge',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'director',
      groups: ['mock-llm'],
      description: '验证 director 在真实 plan exec 中会按顺序串行派发 human task。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createDirectorTestRunner(runtime, {
          structuredOutputScript: {
            'director.intent': [
              {
                output: {
                  mode: 'to_plan',
                  reason: '需要拆成串行子任务。'
                }
              }
            ],
            'director.plan': [
              {
                output: {
                  tasks: [
                    {
                      id: 'task-a',
                      title: 'Task A',
                      userInput: '先完成 A。'
                    },
                    {
                      id: 'task-b',
                      title: 'Task B',
                      userInput: '再完成 B。'
                    }
                  ]
                }
              }
            ],
            'human.brain': [
              {
                output: buildCompleteTaskDecision({
                  summary: 'A 已完成。',
                  reason: '先完成第一个任务。',
                  expectedOutcome: '交回 handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: 'B 已完成。',
                  reason: '第二个任务随后执行。',
                  expectedOutcome: '交回 handoff。'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '综合已完成。',
                  reason: '所有任务均已串行完成。',
                  expectedOutcome: '输出最终结果。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'A 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\nA 已完成。\n\n## 已确认信息\n- 先完成了 task-a。\n\n## 关键证据\n- 当前无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可继续执行 task-b。\n\n## 建议下一步\n- 进入 task-b。'
                }
              },
              {
                output: {
                  summary: 'B 已完成。',
                  deliveryMarkdown:
                    '# 任务交接结果\n\n## 任务完成情况\nB 已完成。\n\n## 已确认信息\n- 紧接着完成了 task-b。\n\n## 关键证据\n- 当前无需额外工具。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n可进入综合。\n\n## 建议下一步\n- 进入 synthesis。'
                }
              },
              {
                output: {
                  summary: '综合已完成。',
                  deliveryMarkdown: '# Final Answer\n\n已按顺序完成 task-a 和 task-b。'
                }
              }
            ]
          }
        })

        const state = await runner.run({
          userInput: '请按顺序执行多个子任务。'
        })

        return {
          state,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const planExecStarts = filterDirectorTaskEventsByStage(
          result.events,
          'task_started',
          'director_plan_exec'
        )

        runtime.assertThat(
          result.state.status === 'completed' &&
            planExecStarts.map((event) => event.taskId).join(',') === 'task-a,task-b',
          {
            name: 'director-plan-exec-stays-serial',
            message: 'director_plan_exec 应按计划顺序串行派发 human task。',
            data: {
              planExecStarts
            }
          }
        )
      }
    })
  })

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
          selectedDocumentIds: ['doc-1'],
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
                const events = filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'tool_call_result')
                const openResult = readLatestHumanToolResultData<DocxOpenResult>({
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
        const kbResult = readLatestHumanToolResultData<Array<{ document_id?: string; text: string }>>({
          events: humanToolResults,
          toolName: 'kb_fts_search_chunks'
        })
        const docxApplyResult = readLatestHumanToolResultData<DocxApplyOpsResult>({
          events: humanToolResults,
          toolName: 'docx_apply_ops'
        })

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
  })
})

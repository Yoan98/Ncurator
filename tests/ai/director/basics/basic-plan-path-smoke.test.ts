import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createQueuedDirectorHumanTaskRunner,
  createTestFileArtifact,
  filterDirectorEventsByType,
  summarizeDirectorEvents
} from '../testUtils'

describe('ai director basics backend', () => {
  it('basic-plan-path-smoke', async () => {
    await runBackendCase({
      caseId: 'basic-plan-path-smoke',
      domain: 'ai',
      suite: 'director',
      groups: ['basics'],
      description: '验证 director 的 plan -> plan_exec -> synthesis 主干路径可以稳定走通。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const taskArtifact = createTestFileArtifact({
          path: `${runtime.workspaceRoot}/artifacts/risk-preview.docx`,
          summary: 'task-2 生成了 docx preview。',
          artifactRole: 'preview'
        })
        const synthesisArtifact = createTestFileArtifact({
          path: `${runtime.workspaceRoot}/artifacts/final-answer.md`,
          capability: 'terminal_exec',
          summary: 'synthesis human 生成最终答复稿。'
        })
        const humanRunner = createQueuedDirectorHumanTaskRunner([
          {
            summary: '已提取风险摘要编写规则。',
            deliveryMarkdown: '# 子任务交付\n\n## 本任务结论\n已提取规则。\n',
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'task-1') {
                throw new Error(`unexpected taskId for first plan task: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'task_handoff') {
                throw new Error('plan task 必须以 task_handoff 模式派发。')
              }
            }
          },
          {
            summary: '已根据规则修改风险摘要文档。',
            deliveryMarkdown: '# 子任务交付\n\n## 本任务结论\n已修改文档并生成预览。\n',
            artifacts: [taskArtifact],
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'task-2') {
                throw new Error(`unexpected taskId for second plan task: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'task_handoff') {
                throw new Error('第二个 plan task 也必须使用 task_handoff。')
              }
              if (!taskInput.userInput.includes('已提取规则。')) {
                throw new Error('前序任务交付未被带入后续 task objective。')
              }
            }
          },
          {
            summary: '已汇总全部子任务并给出最终交付。',
            deliveryMarkdown: '# 处理结果\n\n已完成最终综合交付。',
            artifacts: [synthesisArtifact],
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'synthesis-human') {
                throw new Error(`unexpected synthesis taskId: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'user_answer' || options?.streamAnswer !== true) {
                throw new Error('synthesis human 必须以最终答复模式派发。')
              }
              if (
                !taskInput.userInput.includes('全部任务交付') ||
                !taskInput.userInput.includes('已修改文档并生成预览。')
              ) {
                throw new Error('synthesis objective 未正确包含计划交付与已选范围。')
              }
            }
          }
        ])

        const runner = createDirectorTestRunner(
          runtime,
          {
            chatStructuredOverride: async ({ caller }) => {
              if (caller === 'director.intent') {
                return {
                  mode: 'to_plan',
                  reason: '这是多步骤任务，需要先拆计划。'
                }
              }
              if (caller === 'director.plan') {
                return {
                  tasks: [
                    {
                      id: 'task-1',
                      title: '提取编写规则',
                      userInput:
                        '从已选资料中读取风险摘要模板，提取编写规则，并输出带证据的规则清单。'
                    },
                    {
                      id: 'task-2',
                      title: '修改风险摘要文档',
                      userInput:
                        '基于提取出的规则修改 docs/risk-summary.docx，生成 risk-summary-reviewed.docx 的 preview，并说明未决项。'
                    }
                  ]
                }
              }
              throw new Error(`unexpected chatStructured caller: ${caller}`)
            }
          },
          {
            runHumanTask: humanRunner.runner
          }
        )

        const output = await runner.run({
          userInput: '请先整理规则，再修改风险摘要文档，最后给出综合交付。'
        })

        return {
          output,
          calls: humanRunner.getCalls(),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const startedEvents = filterDirectorEventsByType(result.events, 'task_started')
        const completedEvents = filterDirectorEventsByType(result.events, 'task_completed')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.directorStage === 'director_complete' &&
            result.output.plan.length === 2 &&
            result.output.plan.every((task) => task.status === 'completed') &&
            result.output.finalDeliveryMarkdown === '# 处理结果\n\n已完成最终综合交付。' &&
            result.output.finalArtifacts.length === 2,
          {
            name: 'plan-path-completes-all-plan-tasks-and-synthesis',
            message:
              'basic-plan-path-smoke 应完成 plan、plan_exec 与 synthesis 主干路径，并把任务结果和最终交付稳定回写。',
            data: {
              plan: result.output.plan,
              finalArtifacts: result.output.finalArtifacts
            }
          }
        )

        runtime.assertThat(
          planCreatedEvents.length === 1 &&
            startedEvents.length === 3 &&
            completedEvents.length === 3 &&
            startedEvents.map((event) => event.taskId).join(',') === 'task-1,task-2,synthesis-human' &&
            result.calls.length === 3,
          {
            name: 'plan-path-runs-plan-tasks-serially-before-synthesis',
            message:
              'basic-plan-path-smoke 应先串行执行所有 plan task，再进入 synthesis human，不应跳过或并行派发。',
            data: {
              events: summarizeDirectorEvents(result.events)
            }
          }
        )
      }
    })
  })
})

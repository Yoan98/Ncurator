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
  it('basic-direct-path-smoke', async () => {
    await runBackendCase({
      caseId: 'basic-direct-path-smoke',
      domain: 'ai',
      suite: 'director',
      groups: ['basics'],
      description: '验证 director 的 direct human 默认路径可以稳定走通并完成 run 收尾。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const directArtifact = createTestFileArtifact({
          path: `${runtime.workspaceRoot}/artifacts/direct-answer.md`,
          capability: 'terminal_exec',
          summary: 'direct human 直接产出最终答复。'
        })
        const humanRunner = createQueuedDirectorHumanTaskRunner([
          {
            summary: '已直接完成用户请求。',
            deliveryMarkdown: '# 处理结果\n\n已直接完成本次请求。',
            artifacts: [directArtifact],
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'direct-human') {
                throw new Error(`unexpected direct taskId: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'user_answer' || options?.streamAnswer !== true) {
                throw new Error('direct human 必须以 user_answer + streamAnswer 方式派发。')
              }
              if (
                !taskInput.userInput.includes('# 直接执行任务') ||
                !taskInput.userInput.includes('请直接整理本周风险摘要')
              ) {
                throw new Error('direct human 的 objective 未正确包含直接执行任务上下文。')
              }
            }
          }
        ])

        const runner = createDirectorTestRunner(
          runtime,
          {
            chatStructuredOverride: async ({ caller }) => {
              if (caller !== 'director.intent') {
                throw new Error(`unexpected chatStructured caller: ${caller}`)
              }
              return {
                mode: 'direct_human',
                reason: '当前请求是单任务，direct human 即可闭环。'
              }
            }
          },
          {
            runHumanTask: humanRunner.runner
          }
        )

        const output = await runner.run({
          userInput: '请直接整理本周风险摘要，并给出最终答复。'
        })

        return {
          output,
          calls: humanRunner.getCalls(),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const startedEvents = filterDirectorEventsByType(result.events, 'task_started')
        const completedEvents = filterDirectorEventsByType(result.events, 'task_completed')
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.directorStage === 'director_complete' &&
            result.output.finalDeliveryMarkdown === '# 处理结果\n\n已直接完成本次请求。' &&
            result.output.finalArtifacts.length === 1 &&
            result.output.plan.length === 0,
          {
            name: 'direct-path-completes-with-final-delivery',
            message:
              'basic-direct-path-smoke 应在 direct human 后直接进入 completed，并把最终交付与 artifacts 收口到 run 级状态。',
            data: {
              directorStage: result.output.directorStage,
              status: result.output.status,
              finalArtifacts: result.output.finalArtifacts
            }
          }
        )

        runtime.assertThat(
          startedEvents.length === 1 &&
            completedEvents.length === 1 &&
            planCreatedEvents.length === 0 &&
            startedEvents[0]?.taskId === 'direct-human' &&
            startedEvents[0]?.stage === 'director_direct_human_exec' &&
            completedEvents[0]?.taskId === 'direct-human' &&
            result.calls.length === 1,
          {
            name: 'direct-path-uses-only-one-direct-human-subtask',
            message:
              'basic-direct-path-smoke 只应派发一个 direct human 子任务，不应进入 context 或 plan 链路。',
            data: {
              events: summarizeDirectorEvents(result.events)
            }
          }
        )
      }
    })
  })
})

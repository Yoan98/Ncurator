import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createQueuedDirectorHumanTaskRunner,
  filterDirectorEventsByType,
  summarizeDirectorEvents
} from '../testUtils'

describe('ai director basics backend', () => {
  it('basic-context-path-smoke', async () => {
    await runBackendCase({
      caseId: 'basic-context-path-smoke',
      domain: 'ai',
      suite: 'director',
      groups: ['basics'],
      description: '验证 director 的 context human 路径会补证据并返回 intent 继续后续链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const intentDecisions = [
          {
            mode: 'need_context' as const,
            reason: '当前请求缺少关键约束，先补上下文。'
          },
          {
            mode: 'direct_human' as const,
            reason: '已有足够证据，可以直接完成。'
          }
        ]
        const humanRunner = createQueuedDirectorHumanTaskRunner([
          {
            summary: '已补充当前缺失的关键上下文。',
            deliveryMarkdown: [
              '# 上下文补充结果',
              '',
              '## 本轮结论',
              '已补充当前缺失的关键信息。',
              '',
              '## 可复用证据',
              '- 风险摘要必须包含 owner 字段。',
              '- 发布前需由 Compliance 做最终复核。',
              '',
              '## 当前边界',
              '- 当前只基于已选资料整理上下文。',
              '',
              '## 未决项',
              '无',
              '',
              '## 建议补充方向',
              '- 如需扩展可再补版本对比。'
            ].join('\n'),
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'context-1') {
                throw new Error(`unexpected context taskId: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'context_note' || options?.internalDelivery !== true) {
                throw new Error('context human 必须以 context_note + internalDelivery 方式派发。')
              }
              if (
                !taskInput.userInput.includes('# 上下文补充任务') ||
                !taskInput.userInput.includes('继续刚才的风险总结')
              ) {
                throw new Error('context human 的 objective 未正确包含上下文补充任务信息。')
              }
            }
          },
          {
            summary: '已根据补充后的上下文完成最终答复。',
            deliveryMarkdown: '# 处理结果\n\n已按补充证据完成风险总结。',
            assertTask: ({ taskInput, options }) => {
              if (taskInput.taskId !== 'direct-human') {
                throw new Error(`unexpected direct taskId after context: ${taskInput.taskId}`)
              }
              if (options?.deliveryMode !== 'user_answer' || options?.streamAnswer !== true) {
                throw new Error('context 后的 direct human 必须以最终答复模式派发。')
              }
              if (
                !taskInput.userInput.includes('风险摘要必须包含 owner 字段。') ||
                !taskInput.userInput.includes('发布前需由 Compliance 做最终复核。')
              ) {
                throw new Error('context human 产出的 evidence 未被带入 direct human objective。')
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
              const nextDecision = intentDecisions.shift()
              if (!nextDecision) {
                throw new Error('unexpected extra intent decision request')
              }
              return nextDecision
            }
          },
          {
            runHumanTask: humanRunner.runner
          }
        )

        const output = await runner.run({
          userInput: '继续刚才的风险总结，并告诉我必须保留哪些字段。'
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

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.contextRounds === 1 &&
            result.output.contextObjective === undefined &&
            result.output.contextEvidence.length === 2 &&
            result.output.contextEvidence[0] === '风险摘要必须包含 owner 字段。' &&
            result.output.contextEvidence[1] === '发布前需由 Compliance 做最终复核。' &&
            result.output.finalDeliveryMarkdown === '# 处理结果\n\n已按补充证据完成风险总结。',
          {
            name: 'context-path-updates-evidence-and-returns-to-intent',
            message:
              'basic-context-path-smoke 应正确累计 contextRounds、提取可复用证据，并在回到 intent 后继续完成后续路径。',
            data: {
              contextRounds: result.output.contextRounds,
              contextEvidence: result.output.contextEvidence,
              finalDeliveryMarkdown: result.output.finalDeliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          startedEvents.length === 2 &&
            completedEvents.length === 2 &&
            startedEvents[0]?.taskId === 'context-1' &&
            startedEvents[1]?.taskId === 'direct-human' &&
            result.calls.length === 2,
          {
            name: 'context-path-runs-context-then-direct-in-order',
            message:
              'basic-context-path-smoke 应先执行 context human，再回到 intent 并进入 direct human，事件顺序必须稳定。',
            data: {
              events: summarizeDirectorEvents(result.events)
            }
          }
        )
      }
    })
  })
})

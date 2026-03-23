import { test } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

test('override-integration', async () => {
  await runBackendCase({
    caseId: 'override-integration',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'human',
    description: 'merged human overrides still drive brain, tool execution, and final delivery through the shared override type.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const runner = createHumanTestRunner(
        runtime,
        {
          humanReasonOverrides: [
            {
              output: {
                action: 'load_skill',
                skillId: 'kb-evidence-query',
                rationale: '先加载可用的 KB 检索技能。',
                publicNarrative: '学习所需 KB skill'
              }
            },
            {
              output: {
                action: 'invoke_tool',
                toolName: 'kb_hybrid_search_chunks',
                args: {
                  queryText: '项目风险复核要求'
                },
                rationale: '先拿到可直接引用的知识库证据。',
                publicNarrative: '调用 KB 工具补充证据'
              }
            },
            {
              output: {
                action: 'complete_task',
                summary: '证据已充分，进入最终输出。',
                rationale: '不需要继续调用工具。',
                publicNarrative: '准备输出结论'
              }
            }
          ],
          toolExecutionOverrides: [
            {
              toolName: 'kb_hybrid_search_chunks',
              result: {
                ok: true,
                code: 'ok',
                summary: '通过 override 返回一条知识库证据。',
                data: {
                  items: ['risk evidence']
                }
              }
            }
          ],
          humanDeliveryOverride: () =>
            '# 处理结果\n\n已通过 override 输出最终结论。\n\n## 关键依据\n- risk evidence'
        },
        {
          hardActionLimit: 3
        }
      )

      const output = await runner.run({
        taskId: runtime.taskId,
        userInput: '基于知识库总结项目风险要求'
      })

      return {
        output,
        events: runtime.eventCollector.snapshot()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.output.status === 'completed', {
        name: 'human-override-status',
        message: 'human runner should finish successfully when override chain completes the task',
        data: result.output
      })

      runtime.assertThat(
        String(result.output.deliveryMarkdown || '').includes('已通过 override 输出最终结论'),
        {
          name: 'human-delivery-override',
          message: 'human delivery override should control the final markdown output',
          data: result.output
        }
      )

      const toolStartedEvents = result.events.filter((event) => isEventType(event, 'tool_call_started'))
      const toolResultEvents = result.events.filter((event) => isEventType(event, 'tool_call_result'))
      const humanStepEvents = result.events.filter((event) => isEventType(event, 'human_step'))
      const deliveryEvents = result.events.filter((event) => isEventType(event, 'task_delivery_ready'))

      runtime.assertThat(toolStartedEvents.length === 1 && toolResultEvents.length === 1, {
        name: 'human-tool-override-events',
        message: 'tool execution override should still emit exactly one started/result tool event pair',
        data: {
          toolStartedEvents,
          toolResultEvents
        }
      })

      runtime.assertThat(humanStepEvents.length >= 3, {
        name: 'human-step-events',
        message: 'override-driven learning, tool call, and final delivery should emit human_step events',
        data: humanStepEvents
      })

      runtime.assertThat(deliveryEvents.length === 1, {
        name: 'human-delivery-event',
        message: 'final delivery should emit one task_delivery_ready event',
        data: deliveryEvents
      })
    }
  })
})

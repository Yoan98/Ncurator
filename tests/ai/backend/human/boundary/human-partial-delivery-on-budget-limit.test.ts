import type { AiRunEvent, JsonObject } from '../../../../../src/shared/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

const getToolOutputPreview = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): JsonObject | null => {
  const value = event.outputPreview
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  return value as JsonObject
}

defineAiHumanCase({
  caseId: 'human-partial-delivery-on-budget-limit',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '在步数预算不足时，human 应保留已有进展并给出可继续的部分交付。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-2.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-3.txt',
    'tests/fixtures/ai/workspace/materials/weekly/risk-summary.txt'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '先读取已有材料，尽量在预算内保留可用进展。',
              publicNarrative: '我先读取本地材料，并优先保留已经完成的进展。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '先读取第一份阶段进展。',
              publicNarrative: '我正在读取第 1 份进展材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-2.txt'
              },
              rationale: '继续读取第二份阶段进展。',
              publicNarrative: '我正在读取第 2 份进展材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-3.txt'
              },
              rationale: '在预算耗尽前尽量补齐第三份阶段进展。',
              publicNarrative: '我正在读取第 3 份进展材料。'
            }
          }
        ],
        humanDeliveryOverride: ({ resultCode, summary }) =>
          [
            '# 子任务交付',
            '',
            `状态：${resultCode}`,
            `收敛原因：${summary}`,
            '',
            '## 已完成',
            '- 已读取 workspace scan baseline',
            '- 已读取 KB retrieval baseline',
            '- 已读取 docx review handoff baseline',
            '',
            '## 未完成',
            '- 尚未读取 weekly risk summary',
            '- 尚未生成最终统一 brief',
            '',
            '## 建议后续步骤',
            '- 继续读取 ai/workspace/materials/weekly/risk-summary.txt',
            '- 基于已收集进展生成最终 brief 或 handoff'
          ].join('\n')
      },
      { maxSteps: 4 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '在有限步数内尽量汇总阶段进展；如果做不完，也要保留部分交付并给出下一步。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    return {
      output,
      humanSteps: getEventsByType(runtime, 'human_step'),
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      toolResults: getEventsByType(runtime, 'tool_call_result'),
      terminalSteps: getEventsByType(runtime, 'terminal_step_started')
    }
  },
  assert: async (result, runtime) => {
    const previews = result.toolResults
      .map((event) => getToolOutputPreview(event))
      .filter((item): item is JsonObject => item !== null)
      .map((item) => String(item.outputPreview || ''))

    runtime.assertThat(
      result.output.status === 'blocked' &&
        result.output.resultCode === 'bounded_loop_error' &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-partial-delivery-budget-status',
        message: '预算不足时，human 应以 bounded_loop_error 阻塞，并保留本地资料使用状态'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('workspace scan baseline') &&
        result.output.deliveryMarkdown.includes('KB retrieval baseline') &&
        result.output.deliveryMarkdown.includes('docx review handoff baseline') &&
        result.output.deliveryMarkdown.includes('weekly risk summary'),
      {
        name: 'human-partial-delivery-budget-delivery',
        message: '部分交付应明确已完成进展、未完成部分和继续步骤'
      }
    )
    runtime.assertThat(
      previews.some((text) => text.includes('Completed workspace scan baseline')) &&
        previews.some((text) => text.includes('Completed KB retrieval baseline')) &&
        previews.some((text) => text.includes('Completed docx review handoff baseline')),
      {
        name: 'human-partial-delivery-budget-progress',
        message: '预算耗尽前应至少保留已经读取到的阶段进展'
      }
    )
    runtime.assertThat(
      result.toolCalls.length === 3 &&
        result.terminalSteps.length === 3 &&
        result.humanSteps.some(
          (event) => event.action === 'block_task' && event.resultStatus === 'blocked'
        ),
      {
        name: 'human-partial-delivery-budget-events',
        message: '事件流应体现部分执行后因预算耗尽而阻塞'
      }
    )
  }
})

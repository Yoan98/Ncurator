import type { AiRunEvent, JsonObject } from '../../../../src/shared/types'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from './helpers'

const getToolOutputPreview = (event: Extract<AiRunEvent, { type: 'tool_call_result' }>): JsonObject | null => {
  const value = event.outputPreview
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  return value as JsonObject
}

defineAiHumanCase({
  caseId: 'human-multi-source-merge-delivery',
  caseType: 'scenario',
  groups: [],
  description: 'human 汇总多份 workspace 材料并输出统一交付。',
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
              rationale: '先读取多份 workspace 材料。',
              publicNarrative: '我先收集本地材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '先读取 day 1 进展。',
              publicNarrative: '我正在读取第 1 份材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-2.txt'
              },
              rationale: '再读取 day 2 进展。',
              publicNarrative: '我正在读取第 2 份材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-3.txt'
              },
              rationale: '再读取 day 3 进展。',
              publicNarrative: '我正在读取第 3 份材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/weekly/risk-summary.txt'
              },
              rationale: '最后补充风险清单。',
              publicNarrative: '我正在读取风险汇总材料。'
            }
          },
          {
            decision: {
              action: 'complete_task',
              summary: '已汇总多份材料并形成统一交付。',
              rationale: '多源材料已经足够支撑合并交付。',
              publicNarrative: '我已经完成多源归并，并整理成统一交付。',
              resultData: {
                source_count: 4,
                completed_items: [
                  'workspace scan baseline',
                  'KB retrieval baseline',
                  'docx review handoff baseline'
                ],
                risks: [
                  'Approval branch requires explicit denial coverage.',
                  'Terminal artifact recognition needs end-to-end assertion.'
                ]
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) => {
          const completed = Array.isArray(resultData?.completed_items)
            ? resultData.completed_items.map((item) => `- ${String(item)}`).join('\n')
            : '- 无'
          const risks = Array.isArray(resultData?.risks)
            ? resultData.risks.map((item) => `- ${String(item)}`).join('\n')
            : '- 无'

          return [
            '# 最终答复',
            '',
            `结论：${summary}`,
            '',
            '已完成事项：',
            completed,
            '',
            '风险汇总：',
            risks
          ].join('\n')
        }
      },
      { maxSteps: 7 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '汇总多份日报与风险清单，输出统一交付。'
      },
      {
        deliveryKind: 'final'
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
      .filter((event) => event.toolName === 'terminal_run_command')
      .map((event) => getToolOutputPreview(event))
      .filter((item): item is JsonObject => item !== null)
      .map((item) => String(item.outputPreview || ''))

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.source_count === 4,
      {
        name: 'human-multi-source-merge-completed',
        message: '多源归并任务应形成完成态交付'
      }
    )
    runtime.assertThat(
      previews.some((text) => text.includes('workspace scan baseline')) &&
        previews.some((text) => text.includes('KB retrieval baseline')) &&
        previews.some((text) => text.includes('docx review handoff baseline')) &&
        previews.some((text) => text.includes('Approval branch requires explicit denial coverage')),
      {
        name: 'human-multi-source-merge-materials',
        message: 'human 应读取到多份进展材料与风险清单'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('workspace scan baseline') &&
        result.output.deliveryMarkdown.includes('KB retrieval baseline') &&
        result.output.deliveryMarkdown.includes('docx review handoff baseline') &&
        result.output.deliveryMarkdown.includes('Terminal artifact recognition needs end-to-end assertion'),
      {
        name: 'human-multi-source-merge-delivery',
        message: '统一交付应同时覆盖进展汇总与风险汇总'
      }
    )
    runtime.assertThat(
      result.toolCalls.length === 4 &&
        result.terminalSteps.length === 4 &&
        result.toolCalls.every((event) => event.toolName === 'terminal_run_command'),
      {
        name: 'human-multi-source-merge-order',
        message: '多源归并应按多次 terminal 读取完成材料收集'
      }
    )
    runtime.assertThat(
      result.humanSteps.filter((event) => event.action === 'invoke_tool').length === 4 &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-multi-source-merge-events',
        message: '事件流应记录多次材料读取和最终收敛'
      }
    )
  }
})

import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanCase,
  getEventsByType,
  reasonActivateCapability,
  reasonBlocked,
  reasonInvokeTool
} from '../helpers'

defineAiHumanCase({
  caseId: 'human-watchdog-soft-warn',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '高重复推进时，model watchdog 应发出 soft warn，但最终仍由 human_reason 自行收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        runtimeSettingsOverride: {
          watchdogMode: 'auto'
        },
        humanDeliveryOverride: ({ summary }) => ['# 子任务交付', '', `已完成：${summary}`].join('\n'),
        chatJsonOverride: async () => ({
          level: 'warn',
          summary: '最近多轮没有新增事实，建议尽快收敛。',
          signs: ['repeated_plan', 'no_facts_yet'],
          shouldConverge: false
        }),
        toolExecutionOverrides: [
          {
            toolName: 'kb_list_documents',
            remainingUses: 3,
            result: {
              ok: true,
              code: 'ok',
              summary: 'no local documents matched',
              data: []
            }
          }
        ],
        humanReasonOverrides: [
          {
            output: reasonActivateCapability({
              skillId: 'local-kb-retrieval',
              rationale: '先激活本地 KB 能力。',
              publicNarrative: '我先读取本地资料能力。'
            })
          },
          {
            output: reasonInvokeTool({
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 5
              },
              rationale: '第一次尝试列出可用资料。',
              publicNarrative: '我先列出本地资料。'
            })
          },
          {
            output: reasonInvokeTool({
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 5
              },
              rationale: '再次尝试同一读取。',
              publicNarrative: '我再次确认本地资料列表。'
            })
          },
          {
            output: reasonInvokeTool({
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 5
              },
              rationale: '第三次重复读取。',
              publicNarrative: '我继续检查本地资料列表。'
            })
          },
          {
            output: reasonBlocked({
              summary: 'watchdog 已提示重复读取无新增事实，当前任务在资料不足下应停止。',
              rationale: '高重复读取后没有新证据，直接阻塞更合理。'
            })
          }
        ]
      },
      { hardActionLimit: 8 }
    )

    const output = await runner.run({
      taskId: runtime.taskId,
      objective: '在重复读取本地 KB 无新增事实时，验证 watchdog soft warn 会被记录。'
    })

    return {
      output,
      watchdogSignals: getEventsByType(runtime, 'watchdog_signal')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.output.status === 'blocked', {
      name: 'human-watchdog-soft-warn-blocked',
      message: 'soft warn 场景最终应由 human_reason 自行收敛为 blocked'
    })
    runtime.assertThat(
      result.watchdogSignals.some(
        (event) =>
          event.level === 'warn' && event.summary.includes('建议尽快收敛')
      ),
      {
        name: 'human-watchdog-soft-warn-signal',
        message: 'watchdog soft warn 应写入事件流'
      }
    )
  }
})

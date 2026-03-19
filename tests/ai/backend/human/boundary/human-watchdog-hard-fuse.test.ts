import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanCase,
  getEventsByType,
  reasonActivateCapability,
  reasonInvokeTool
} from '../helpers'

defineAiHumanCase({
  caseId: 'human-watchdog-hard-fuse',
  caseType: 'boundary',
  groups: ['boundary'],
  description: 'hard fuse 命中后，最后一次 reason 若仍不收敛，应被强制合成为 blocked。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        runtimeSettingsOverride: {
          watchdogMode: 'off'
        },
        humanDeliveryOverride: ({ summary }) => ['# 子任务交付', '', `已完成：${summary}`].join('\n'),
        toolExecutionOverrides: [
          {
            toolName: 'kb_list_documents',
            remainingUses: 2,
            result: {
              ok: true,
              code: 'ok',
              summary: 'still scanning local documents',
              data: []
            }
          }
        ],
        humanReasonOverrides: [
          {
            output: reasonActivateCapability({
              skillId: 'local-kb-retrieval',
              rationale: '先加载本地 KB 能力。',
              publicNarrative: '我先激活本地资料能力。'
            })
          },
          {
            output: reasonInvokeTool({
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 5
              },
              rationale: '第一次尝试列资料。',
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
              rationale: '即使逼近边界，仍继续重复同一动作。',
              publicNarrative: '我继续重复读取本地资料。'
            })
          }
        ]
      },
      { hardActionLimit: 2 }
    )

    const output = await runner.run({
      taskId: runtime.taskId,
      objective: '验证 hard fuse 命中后会强制最后一次收敛，并在仍未收敛时合成为 blocked。'
    })

    return {
      output,
      watchdogSignals: getEventsByType(runtime, 'watchdog_signal'),
      humanSteps: getEventsByType(runtime, 'human_step')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'blocked' && result.output.resultCode === 'bounded_loop_error',
      {
        name: 'human-watchdog-hard-fuse-blocked',
        message: 'hard fuse 场景应被强制收敛为 blocked，并返回 bounded_loop_error'
      }
    )
    runtime.assertThat(
      result.watchdogSignals.some((event) => event.level === 'stop'),
      {
        name: 'human-watchdog-hard-fuse-signal',
        message: 'hard fuse 命中时应写入 stop 级 watchdog 事件'
      }
    )
    runtime.assertThat(
      result.humanSteps.some((event) => event.action === 'block_task' && event.summary.includes('watchdog')),
      {
        name: 'human-watchdog-hard-fuse-terminal-step',
        message: '最终事件流应记录 watchdog 触发的阻塞收敛'
      }
    )
  }
})

import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanCase,
  getEventsByType,
  reasonActivateCapability,
  reasonBlocked,
  reasonInvokeTool
} from '../helpers'

defineAiHumanCase({
  caseId: 'human-watch-hint-soft-warn',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '重复学习同一 skill 时，learning 节点应发出 watch hint，并由 brain 显式收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        humanDeliveryOverride: ({ summary }) => ['# 子任务交付', '', `已完成：${summary}`].join('\n'),
        humanReasonOverrides: [
          {
            output: reasonActivateCapability({
              skillIds: ['kb-evidence-query'],
              rationale: '先激活本地 KB 能力。',
              publicNarrative: '我先读取本地资料能力。'
            })
          },
          {
            output: reasonActivateCapability({
              skillIds: ['kb-evidence-query'],
              rationale: '重复学习同一 skill，应触发 learning watch hint。',
              publicNarrative: '我再次请求同一个 skill。'
            })
          },
          {
            output: reasonBlocked({
              summary: '重复学习同一 skill 没有新增收益，当前任务先阻塞并等待新的明确计划。',
              rationale: 'learning watch hint 已提示重复学习，当前应停止无效推进。'
            })
          }
        ]
      },
      { hardActionLimit: 8 }
    )

    const output = await runner.run({
      taskId: runtime.taskId,
      userInput: '在重复读取本地 KB 无新增事实时，验证 watch hint soft warn 会被记录。'
    })

    return {
      output,
      watchHints: getEventsByType(runtime, 'watch_hint')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.output.status === 'blocked', {
      name: 'human-watch-hint-soft-warn-blocked',
      message: '重复学习场景最终应由 brain 显式收敛为 blocked'
    })
    runtime.assertThat(
      result.watchHints.some(
        (event) =>
          event.source === 'learning' && event.summary.includes('重复学习')
      ),
      {
        name: 'human-watch-hint-soft-warn-signal',
        message: 'learning 重复学习应写入 watch hint 事件'
      }
    )
  }
})

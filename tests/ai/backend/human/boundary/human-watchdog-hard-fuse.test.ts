import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanCase,
  getEventsByType,
  reasonActivateCapability,
  reasonBlocked,
  reasonInvokeTool
} from '../helpers'

defineAiHumanCase({
  caseId: 'human-watch-hint-hard-fuse',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '累计工具调用超过上限后，hand 节点应发出 watch hint，并由 brain 显式阻塞收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        humanDeliveryOverride: ({ summary }) => ['# 子任务交付', '', `已完成：${summary}`].join('\n'),
        toolExecutionOverrides: [
          {
            toolName: 'kb_list_documents',
            remainingUses: 3,
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
              skillIds: ['kb-document-discovery', 'kb-evidence-query'],
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
          },
          {
            output: reasonInvokeTool({
              toolName: 'kb_list_documents',
              args: {
                page: 1,
                pageSize: 5
              },
              rationale: '第三次继续调用，将触发累计工具次数 watch hint。',
              publicNarrative: '我第三次重复读取本地资料。'
            })
          },
          {
            output: reasonBlocked({
              summary: '累计工具调用已超出当前上限，当前任务先阻塞并等待更精简的计划。',
              rationale: 'hand watch hint 已提示超限，继续重复调用没有收益。'
            })
          }
        ]
      },
      { hardActionLimit: 2 }
    )

    const output = await runner.run({
      taskId: runtime.taskId,
      userInput: '验证 hard fuse 命中后会强制最后一次收敛，并在仍未收敛时合成为 blocked。'
    })

    return {
      output,
      watchHints: getEventsByType(runtime, 'watch_hint'),
      humanSteps: getEventsByType(runtime, 'human_step')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'blocked',
      {
        name: 'human-watch-hint-hard-fuse-blocked',
        message: '累计工具调用超限后应阻塞收敛'
      }
    )
    runtime.assertThat(
      result.watchHints.some(
        (event) => event.source === 'hand' && event.summary.includes('超过临时上限 2')
      ),
      {
        name: 'human-watch-hint-hard-fuse-signal',
        message: '工具调用超限时应写入 hand watch hint 事件'
      }
    )
    runtime.assertThat(
      result.humanSteps.some(
        (event) => event.action === 'block_result' && event.summary.includes('超出当前上限')
      ),
      {
        name: 'human-watch-hint-hard-fuse-terminal-step',
        message: '最终事件流应记录工具超限后的阻塞收敛'
      }
    )
  }
})

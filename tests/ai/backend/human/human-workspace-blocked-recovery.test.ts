import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from './helpers'

defineAiHumanCase({
  caseId: 'human-workspace-blocked-recovery',
  caseType: 'scenario',
  groups: [],
  description: '缺少 workspace 绑定时，human 应上抛 workspace_required 并给出继续条件。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        bindWorkspace: false,
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '需要读取本地工作区材料。',
              publicNarrative: '我先尝试读取当前工作区材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/human-input.txt'
              },
              rationale: '直接读取目标材料。',
              publicNarrative: '我正在读取工作区文件。'
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultCode }) =>
          [
            '# 子任务交付',
            '',
            `状态：${resultCode}`,
            `阻塞说明：${summary}`,
            '继续条件：请先绑定 workspace，再继续执行本地读取任务。'
          ].join('\n')
      },
      { maxSteps: 3 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '读取当前 workspace 里的本地材料。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    return {
      output,
      workspaceRequiredEvents: getEventsByType(runtime, 'workspace_required'),
      humanSteps: getEventsByType(runtime, 'human_step'),
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      terminalSteps: getEventsByType(runtime, 'terminal_step_started'),
      deliveries: getEventsByType(runtime, 'task_delivery_ready')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'blocked' &&
        result.output.resultCode === 'workspace_required' &&
        result.output.deliveryMarkdown.includes('绑定 workspace'),
      {
        name: 'human-workspace-blocked-status',
        message: '缺少 workspace 时，human 应阻塞并明确要求补充 workspace'
      }
    )
    runtime.assertThat(
      result.workspaceRequiredEvents.length === 1 &&
        result.humanSteps.some(
          (event) => event.toolName === 'terminal_run_command' && event.resultStatus === 'blocked'
        ) &&
        result.toolCalls.length === 0,
      {
        name: 'human-workspace-blocked-events',
        message: '缺少 workspace 时，应触发 workspace_required，并在 human_step 中记录阻塞'
      }
    )
    runtime.assertThat(result.terminalSteps.length === 0 && result.deliveries.length === 1, {
      name: 'human-workspace-blocked-no-terminal-step',
      message: 'workspace guard 阻塞后不应真正执行 terminal step，但应给出交付'
    })
  }
})

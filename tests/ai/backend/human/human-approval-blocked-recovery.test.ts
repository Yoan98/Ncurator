import fs from 'node:fs/promises'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from './helpers'

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

defineAiHumanCase({
  caseId: 'human-approval-blocked-recovery',
  caseType: 'scenario',
  groups: [],
  description: '遇到审批拒绝时，human 应停在正确节点，并说明继续条件。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        approvalPolicy: 'deny-all',
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '需要写入工作区产物。',
              publicNarrative: '我先尝试生成目标文件。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'touch blocked-approval.txt'
              },
              rationale: '先执行需要审批的写操作。',
              publicNarrative: '我正在申请执行写入命令。'
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultCode }) =>
          [
            '# 子任务交付',
            '',
            `状态：${resultCode}`,
            `阻塞说明：${summary}`,
            '继续条件：请批准写操作后再继续执行。'
          ].join('\n')
      },
      { maxSteps: 3 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '在 workspace 中生成一个目标文件。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    return {
      output,
      approvalRequiredEvents: getEventsByType(runtime, 'approval_required'),
      approvalDecisionEvents: getEventsByType(runtime, 'approval_decision'),
      terminalSteps: getEventsByType(runtime, 'terminal_step_started'),
      blockedExists: await exists(`${runtime.workspaceRoot}/blocked-approval.txt`)
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'blocked' &&
        result.output.resultCode === 'approval_denied' &&
        result.output.deliveryMarkdown.includes('批准'),
      {
        name: 'human-approval-blocked-status',
        message: '审批拒绝时，human 应阻塞并明确要求批准后再继续'
      }
    )
    runtime.assertThat(
      result.approvalRequiredEvents.length === 1 &&
        result.approvalDecisionEvents.length === 1 &&
        result.approvalDecisionEvents[0]?.approved === false,
      {
        name: 'human-approval-blocked-events',
        message: '审批拒绝路径应留下完整的 approval_required / approval_decision 事件'
      }
    )
    runtime.assertThat(!result.blockedExists && result.terminalSteps.length === 0, {
      name: 'human-approval-blocked-no-side-effect',
      message: '审批拒绝后不应执行真正写入，也不应留下产物'
    })
  }
})

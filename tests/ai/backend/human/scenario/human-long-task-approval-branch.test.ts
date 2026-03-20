import fs from 'node:fs/promises'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType, reasonBlocked } from '../helpers'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

const readFileText = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

defineAiHumanCase({
  caseId: 'human-long-task-approval-branch',
  caseType: 'scenario',
  groups: ['scenario'],
  description: '长任务中途需要审批时，human 应在批准与拒绝两条分支上都安全推进或收敛。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/weekly/risk-summary.txt'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const approvedTaskId = `${runtime.taskId}-approved`
    const deniedTaskId = `${runtime.taskId}-denied`
    const approvedPath = `${runtime.workspaceRoot}/approved-branch.txt`
    const deniedPath = `${runtime.workspaceRoot}/denied-branch.txt`

    const approvedRunner = createHumanTestRunner(
      runtime,
      {
        approvalPolicy: 'auto-approve',
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillIds: ['workspace-cli'],
              rationale: '先收集长任务需要的本地事实。',
              publicNarrative: '我先读取本地材料，准备导出交付。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '读取阶段进展。',
              publicNarrative: '我正在读取阶段进展材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/weekly/risk-summary.txt'
              },
              rationale: '补齐风险约束。',
              publicNarrative: '我正在读取风险汇总材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command:
                  'printf "workspace scan baseline\\napproval branch requires explicit denial coverage\\n" > approved-branch.txt'
              },
              rationale: '把长任务归并结果导出成工作区文件，这一步需要审批。',
              publicNarrative: '我正在申请导出本轮交付文件。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '审批已通过，长任务导出文件已生成。',
              rationale: '批准分支已成功推进到产物落地。',
              publicNarrative: '我已经在批准分支完成导出交付。'
            }
          }
        ],
        humanDeliveryOverride: ({ summary }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            '审批分支：approved',
            '导出文件：approved-branch.txt'
          ].join('\n')
      },
      { hardActionLimit: 6 }
    )

    const deniedRunner = createHumanTestRunner(
      runtime,
      {
        approvalPolicy: 'deny-all',
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillIds: ['workspace-cli'],
              rationale: '先读取长任务所需的本地事实。',
              publicNarrative: '我先读取本地材料，准备尝试导出交付。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '读取阶段进展。',
              publicNarrative: '我正在读取阶段进展材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/weekly/risk-summary.txt'
              },
              rationale: '补齐风险约束。',
              publicNarrative: '我正在读取风险汇总材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command:
                  'printf "workspace scan baseline\\napproval branch requires explicit denial coverage\\n" > denied-branch.txt'
              },
              rationale: '尝试导出最终交付，但这一步需要审批。',
              publicNarrative: '我正在申请导出本轮交付文件。'
            }
          },
          {
            output: reasonBlocked({
              summary: '导出写入操作被拒绝，请批准后再继续生成 denied-branch.txt。',
              rationale: '审批已拒绝，当前分支应阻塞并保留已有进展。'
            })
          }
        ],
        humanDeliveryOverride: ({ summary }) =>
          [
            '# 子任务交付',
            '',
            '状态：blocked',
            `阻塞说明：${summary}`,
            '已保留进展：已读取阶段进展与风险汇总。',
            '继续条件：请批准导出写入操作后再继续生成 denied-branch.txt。'
          ].join('\n')
      },
      { hardActionLimit: 5 }
    )

    const approvedOutput = await approvedRunner.run(
      {
        taskId: approvedTaskId,
        userInput: '读取本地材料并导出长任务 brief；如果审批通过，就生成 approved-branch.txt。'
      }
    )

    const deniedOutput = await deniedRunner.run(
      {
        taskId: deniedTaskId,
        userInput: '读取本地材料并导出长任务 brief；如果审批被拒绝，就安全收敛。'
      }
    )

    const approvals = getEventsByType(runtime, 'approval_required')
    const approvalDecisions = getEventsByType(runtime, 'approval_decision')
    const terminalSteps = getEventsByType(runtime, 'terminal_step_started')

    return {
      approvedOutput,
      deniedOutput,
      approvedExists: await fileExists(approvedPath),
      deniedExists: await fileExists(deniedPath),
      approvedText: await readFileText(approvedPath),
      approvals,
      approvalDecisions,
      terminalSteps
    }
  },
  assert: async (result, runtime) => {
    const approvedApprovals = result.approvals.filter((event) => event.taskId.endsWith('-approved'))
    const deniedApprovals = result.approvals.filter((event) => event.taskId.endsWith('-denied'))
    const approvedDecisions = result.approvalDecisions.filter((event) =>
      event.taskId.endsWith('-approved')
    )
    const deniedDecisions = result.approvalDecisions.filter((event) =>
      event.taskId.endsWith('-denied')
    )
    const approvedTerminalSteps = result.terminalSteps.filter((event) =>
      event.taskId.endsWith('-approved')
    )
    const deniedTerminalSteps = result.terminalSteps.filter((event) =>
      event.taskId.endsWith('-denied')
    )

    runtime.assertThat(
      result.approvedOutput.status === 'completed' &&
        result.approvedOutput.deliveryMarkdown.includes('approved-branch.txt') &&
        result.approvedExists,
      {
        name: 'human-long-task-approval-branch-approved',
        message: '批准分支应继续推进并生成导出产物'
      }
    )
    runtime.assertThat(
      result.deniedOutput.status === 'blocked' &&
        !result.deniedExists &&
        result.deniedOutput.deliveryMarkdown.includes('请批准导出写入操作后再继续'),
      {
        name: 'human-long-task-approval-branch-denied',
        message: '拒绝分支应安全阻塞，不应留下写入副作用'
      }
    )
    runtime.assertThat(
      approvedApprovals.length === 1 &&
        deniedApprovals.length === 1 &&
        approvedDecisions.length === 1 &&
        approvedDecisions[0]?.approved === true &&
        deniedDecisions.length === 1 &&
        deniedDecisions[0]?.approved === false,
      {
        name: 'human-long-task-approval-branch-events',
        message: '两条审批分支都应留下完整的 approval_required / approval_decision 事件'
      }
    )
    runtime.assertThat(
      approvedTerminalSteps.length === 3 &&
        deniedTerminalSteps.length === 2 &&
        result.approvedText.includes('workspace scan baseline') &&
        result.approvedText.includes('approval branch requires explicit denial coverage'),
      {
        name: 'human-long-task-approval-branch-side-effects',
        message: '批准分支应真正执行导出，拒绝分支只保留前置读取进展'
      }
    )
  }
})

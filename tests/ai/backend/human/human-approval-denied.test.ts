import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'

describe('human approval denied', () => {
  it('blocks on approval-denied commands instead of continuing execution', async () => {
    await runBackendCase({
      caseId: 'human-approval-denied',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 在命中审批拒绝时会正确阻塞',
      fixtures: [],
      runMode: 'single',
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
                  rationale: '需要先加载 workspace shell。',
                  publicNarrative: '我先加载工作区 shell 能力。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'touch approval-target.txt'
                  },
                  rationale: '需要写出一个文件。',
                  publicNarrative: '我尝试执行会写文件的命令。'
                }
              }
            ]
          },
          {
            maxSteps: 3
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective: '在工作区里创建 approval-target.txt。'
          },
          {
            deliveryKind: 'handoff',
            streamAnswer: false
          }
        )

        runtime.recordEvent({
          type: 'step',
          name: 'human-approval-denied',
          status: output.status === 'blocked' ? 'ok' : 'failed',
          message:
            output.status === 'blocked'
              ? 'human 在审批拒绝后正确阻塞'
              : 'human 在审批拒绝后未正确阻塞',
          data: {
            status: output.status,
            resultCode: output.resultCode,
            summary: output.summary
          }
        })

        return {
          output,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'blocked' &&
            result.output.resultCode === 'approval_denied' &&
            result.output.summary.includes('approval') &&
            result.output.deliveryMarkdown.includes('子任务交付'),
          {
            name: 'human-approval-denied-blocked',
            message: 'human 在审批拒绝后返回 blocked/approval_denied，并生成部分交付',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              summary: result.output.summary
            }
          }
        )

        const approvalRequired = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_required'
        )
        const approvalDenied = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_decision' && event.approved === false
        )
        const blockedInvoke = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'human_step' &&
            event.action === 'invoke_tool' &&
            event.resultStatus === 'blocked'
        )
        const taskDelivery = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'task_delivery_ready'
        )

        runtime.assertThat(
          approvalRequired.length === 1 &&
            approvalDenied.length === 1 &&
            blockedInvoke.length === 1 &&
            taskDelivery.length === 1,
          {
            name: 'human-approval-denied-events',
            message: '审批事件、blocked invoke_tool 与部分交付事件都已记录',
            data: {
              approvalRequired: approvalRequired.length,
              approvalDenied: approvalDenied.length,
              blockedInvoke: blockedInvoke.length,
              taskDelivery: taskDelivery.length
            }
          }
        )
      }
    })
  })
})

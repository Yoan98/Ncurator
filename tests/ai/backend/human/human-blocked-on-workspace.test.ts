import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'

describe('human blocked on workspace', () => {
  it('surfaces workspace-required blocking instead of continuing to hallucinate', async () => {
    await runBackendCase({
      caseId: 'human-blocked-on-workspace',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 在缺少 workspace 绑定时会正确阻塞，而不是继续执行 shell 任务',
      fixtures: [],
      runMode: 'single',
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
                  rationale: '需要先获得 workspace shell 能力。',
                  publicNarrative: '我先加载工作区 shell 能力。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'terminal_run_command',
                  args: {
                    command: 'cat notes.txt'
                  },
                  rationale: '需要读取工作区里的文件内容。',
                  publicNarrative: '我尝试读取工作区里的材料。'
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
            objective: '去工作区里读取 notes.txt，然后告诉我里面写了什么。'
          },
          {
            deliveryKind: 'handoff',
            streamAnswer: false
          }
        )

        runtime.recordEvent({
          type: 'step',
          name: 'human-blocked-on-workspace',
          status: output.status === 'blocked' ? 'ok' : 'failed',
          message:
            output.status === 'blocked'
              ? 'human 在缺少 workspace 时正确阻塞'
              : 'human 在缺少 workspace 时未正确阻塞',
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
            result.output.resultCode === 'workspace_required' &&
            result.output.summary.includes('workspace'),
          {
            name: 'human-workspace-blocked',
            message: 'human 缺少 workspace 时会返回 blocked/workspace_required',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              summary: result.output.summary
            }
          }
        )
        runtime.assertThat(result.output.deliveryMarkdown.trim() === '', {
          name: 'human-workspace-blocked-no-delivery',
          message: '当前实现下，workspace_required 阻塞不会生成误导性的正式交付'
        })

        const workspaceRequiredEvents = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'workspace_required'
        )
        const blockedHumanSteps = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'human_step' &&
            event.action === 'invoke_tool' &&
            event.resultStatus === 'blocked'
        )
        const taskDelivery = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'task_delivery_ready'
        )

        runtime.assertThat(
          workspaceRequiredEvents.length === 1 &&
            blockedHumanSteps.length === 1 &&
            taskDelivery.length === 0,
          {
            name: 'human-workspace-blocked-events',
            message: 'workspace_required 与 blocked human_step 已记录，且没有错误生成 task_delivery_ready',
            data: {
              workspaceRequired: workspaceRequiredEvents.length,
              blockedHumanSteps: blockedHumanSteps.length,
              taskDelivery: taskDelivery.length
            }
          }
        )
      }
    })
  })
})

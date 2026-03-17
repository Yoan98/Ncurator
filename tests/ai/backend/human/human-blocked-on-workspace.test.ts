import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'

const liveModelConfig = hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv() : null

describe('human blocked on workspace', () => {
  it('surfaces workspace-required blocking instead of continuing to hallucinate', async () => {
    const isLiveMode = liveModelConfig !== null

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
      runtimeModelName: liveModelConfig?.model_name || null,
      execute: async (runtime) => {
        const runner = createHumanTestRunner(
          runtime,
          {
            bindWorkspace: false,
            liveModelConfig: liveModelConfig || undefined,
            humanDecisionOverrides: isLiveMode
              ? undefined
              : [
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
                ],
            humanDeliveryOverride: () =>
              [
                '# 子任务交付',
                '',
                '## 已完成',
                '当前未读取到工作区文件。',
                '',
                '## 风险与未决',
                '缺少 workspace 绑定，无法继续读取本地材料。'
              ].join('\n')
          },
          {
            maxSteps: isLiveMode ? 5 : 3
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
            result.output.summary.includes('workspace') &&
            result.output.deliveryMarkdown.includes('子任务交付'),
          {
            name: 'human-workspace-blocked',
            message: 'human 缺少 workspace 时会返回 blocked/workspace_required，并保留部分交付',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              summary: result.output.summary
            }
          }
        )

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
          (isLiveMode ? workspaceRequiredEvents.length >= 1 : workspaceRequiredEvents.length === 1) &&
            (isLiveMode ? blockedHumanSteps.length >= 1 : blockedHumanSteps.length === 1) &&
            taskDelivery.length === 1,
          {
            name: 'human-workspace-blocked-events',
            message: 'workspace_required、blocked human_step 与部分交付事件都已记录',
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

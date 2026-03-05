import path from 'node:path'
import { describe, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../harness/llmConfig'
import { recordAssertion } from '../../harness/assertions'
import { runHumanLiveCase } from '../../harness/humanLiveCase'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/ai/fixtures/workspace/human-input.txt')

describe('human-live', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 应能读取 workspace 文件并完成任务', async () => {
    await runHumanLiveCase({
      caseId: 'human-read-workspace-file',
      description: '验证 human 子图在真实模型下通过 terminal 工具读取文件并完成任务。',
      objective:
        '请在当前 workspace 中读取 input.txt 的第一行，并调用 complete_task 结束任务；outputs 必须包含 first_line 字段。',
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      approvalPolicy: 'auto-approve',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const hasToolCall = events.some((event) => event.type === 'tool_call_started')
        const hasCompleteStep = events.some(
          (event) =>
            event.type === 'human_step' &&
            event.action === 'complete_task' &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.completed',
          pass: result.status === 'completed',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.tool-call',
          pass: hasToolCall,
          details: 'expected at least one tool_call_started event'
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.complete-step',
          pass: hasCompleteStep,
          details: 'expected a human_step with action=complete_task'
        })
      }
    })
  })
})

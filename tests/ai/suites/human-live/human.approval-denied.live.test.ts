import path from 'node:path'
import { describe, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../harness/llmConfig'
import { recordAssertion } from '../../harness/assertions'
import { runHumanLiveCase } from '../../harness/humanLiveCase'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/ai/fixtures/workspace/human-input.txt')

describe('human-live', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在风险审批拒绝时应阻塞收敛', async () => {
    await runHumanLiveCase({
      caseId: 'human-approval-denied-block',
      description: '验证 human-live 场景下审批策略注入为 deny 时的阻塞收敛路径。',
      objective:
        '请在当前 workspace 中创建一个新目录 tmp-created-dir，然后完成任务。若无法执行，请按规则阻塞并说明原因。',
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      approvalPolicy: 'deny-medium-high',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const approvalDenied = events.some(
          (event) =>
            event.type === 'approval_decision' &&
            event.approved === false &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.blocked',
          pass: result.status === 'blocked',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.approval-denied',
          pass: result.resultCode === 'approval_denied',
          details: `resultCode=${result.resultCode}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.approval-denied',
          pass: approvalDenied,
          details: 'expected approval_decision with approved=false'
        })
      }
    })
  })
})

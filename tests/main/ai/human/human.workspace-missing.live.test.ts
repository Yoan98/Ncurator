import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-workspace-missing-block'
const CASE_METADATA = {
  description: '验证 human 在 workspace 未绑定时尝试 shell 工具会以 workspace_required 阻塞。',
  taskGoal:
    '请在当前 workspace 中读取 input.txt 的第一行。若 workspace 不可用，请按规则阻塞并说明原因。只有在读取成功时才完成任务，且 resultData 必须包含 first_line 字段。',
  scenarioTags: ['human', 'workspace-required', 'negative-path'],
  expectedOutcome: 'blocked',
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: []
} as const

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在 workspace 未绑定时应以 workspace_required 阻塞', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      objective: CASE_METADATA.taskGoal,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      bindWorkspace: false,
      approvalPolicy: 'auto-approve',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const workspaceRequired = events.some(
          (event) =>
            event.type === 'workspace_required' &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.blocked',
          pass: result.status === 'blocked',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.workspace-required',
          pass: result.resultCode === 'workspace_required',
          details: `resultCode=${result.resultCode}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.workspace-required',
          pass: workspaceRequired,
          details: 'expected workspace_required event'
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.metrics.executionResultCode).toBe('workspace_required')
    expect(report.metrics.workspaceRequiredCount).toBeGreaterThanOrEqual(1)
    expect(report.signals.finalHumanAction).toBe('block_task')
    expect(report.metrics.qualityGrade).toBe('expected_block')
  }, 360000)
})

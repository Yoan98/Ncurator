import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-local-evidence-insufficient-block'
const CASE_METADATA = {
  description: '验证 human 在 workspace 中没有足够本地证据时阻塞收敛。',
  taskGoal:
    '请仅根据当前 workspace 中的本地文件，告诉我 input.txt 的作者姓名。如果本地证据不足，请阻塞并说明原因；不要猜测。只有在确认无误时才完成任务，且 resultData 必须包含 author 字段。',
  scenarioTags: ['human', 'local-first', 'insufficient-evidence'],
  expectedOutcome: 'blocked',
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: []
} as const

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在本地证据不足时应阻塞而非猜测完成', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      objective: CASE_METADATA.taskGoal,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      approvalPolicy: 'auto-approve',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const toolCallCount = events.filter(
          (event) =>
            event.type === 'tool_call_started' &&
            String(event.taskId || '') === runtime.taskId
        ).length

        recordAssertion(runtime.assertions, {
          id: 'human.status.blocked',
          pass: result.status === 'blocked',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.local-check-attempted',
          pass: toolCallCount >= 1,
          details: `toolCallCount=${toolCallCount}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.no-author',
          pass: result.resultData?.author === undefined,
          details: JSON.stringify(result.resultData)
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.signals.finalHumanAction).toBe('block_task')
    expect(report.metrics.toolCallCount).toBeGreaterThanOrEqual(1)
    expect(report.signals.resultDataKeys).not.toContain('author')
    expect(report.metrics.qualityGrade).toBe('expected_block')
  })
})

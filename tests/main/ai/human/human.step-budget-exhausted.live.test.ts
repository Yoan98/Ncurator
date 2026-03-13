import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-step-budget-exhausted-block'
const CASE_METADATA = {
  description: '验证 human 在极低步数预算下不会伪造完成，而是以 bounded_loop_error 阻塞收敛。',
  taskGoal:
    '请在当前 workspace 中读取 input.txt 的第一行。你可以按需加载能力；完成任务时 resultData 必须包含 first_line 字段。',
  scenarioTags: ['human', 'step-budget', 'negative-path'],
  expectedOutcome: 'blocked',
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: []
} as const

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在步数预算耗尽时应阻塞收敛', async () => {
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
      maxSteps: 1,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const toolCallCount = events.filter((event) => event.type === 'tool_call_started').length
        const exhaustedDiagnostic = events.some(
          (event) =>
            event.type === 'human_diagnostic' &&
            String(event.trace.rationale || '').includes('exceeded max steps') &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.blocked',
          pass: result.status === 'blocked',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.bounded-loop-error',
          pass: result.resultCode === 'bounded_loop_error',
          details: `resultCode=${result.resultCode}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.no-tool-call',
          pass: toolCallCount === 0,
          details: `toolCallCount=${toolCallCount}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.budget-exhausted-diagnostic',
          pass: exhaustedDiagnostic,
          details: 'expected human_diagnostic with exceeded max steps'
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.metrics.executionResultCode).toBe('bounded_loop_error')
    expect(report.signals.finalHumanAction).toBe('block_task')
    expect(report.metrics.qualityGrade).toBe('expected_block')
  })
})

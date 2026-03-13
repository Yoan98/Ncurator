import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-tool-error-recovery'
const EXPECTED_FIRST_LINE = 'Hello from human fixture.'
const CASE_METADATA = {
  description: '验证 human 在第一次 terminal 工具失败后能够恢复并完成任务。',
  taskGoal:
    '请在当前 workspace 中读取 input.txt 的第一行。若工具第一次执行失败，请根据错误继续恢复并完成任务；不要直接放弃。完成任务时 resultData 必须包含 first_line 字段。',
  scenarioTags: ['human', 'recovery', 'tool-error'],
  expectedOutcome: 'success',
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: ['human-default']
} as const

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在单次工具失败后应恢复完成任务', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      objective: CASE_METADATA.taskGoal,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      toolExecutionOverrides: [
        {
          toolName: 'terminal_run_command',
          result: {
            ok: false,
            code: 'failed',
            summary: 'injected terminal failure for recovery test',
            data: {
              ok: false,
              code: 'failed',
              error: 'injected terminal failure for recovery test'
            }
          }
        }
      ],
      approvalPolicy: 'auto-approve',
      maxSteps: 10,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const terminalCalls = events.filter(
          (event) =>
            event.type === 'tool_call_started' &&
            event.toolName === 'terminal_run_command' &&
            String(event.taskId || '') === runtime.taskId
        ).length

        recordAssertion(runtime.assertions, {
          id: 'human.status.completed',
          pass: result.status === 'completed',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.terminal-retried',
          pass: terminalCalls >= 2,
          details: `terminalCalls=${terminalCalls}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.first-line',
          pass: result.resultData?.first_line === EXPECTED_FIRST_LINE,
          details: JSON.stringify(result.resultData)
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.toolErrorCount).toBeGreaterThanOrEqual(1)
    expect(report.metrics.recoveryAfterErrorCount).toBeGreaterThanOrEqual(1)
    expect(report.metrics.toolCallCount).toBeGreaterThanOrEqual(2)
    expect(report.metrics.qualityGrade).toBe('soft_pass')
  }, 240000)
})

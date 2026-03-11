import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanLiveCase } from '../../../harness/main/humanLiveCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-read-workspace-file'

describe('human-live', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 应能读取 workspace 文件并完成任务', async () => {
    await runHumanLiveCase({
      caseId: CASE_ID,
      description: '验证 human 子图在真实模型下通过 terminal 工具读取文件并完成任务。',
      objective:
        '请在当前 workspace 中读取 input.txt 的第一行。你可以按需加载能力；完成任务时 resultData 必须包含 first_line 字段。',
      expectedOutcome: 'success',
      scenarioTags: ['human-live', 'workspace-read', 'success-path'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      approvalPolicy: 'auto-approve',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const skillLoadIndex = events.findIndex(
          (event) =>
            event.type === 'human_step' &&
            event.action === 'load_skill' &&
            event.skillId === 'workspace-shell' &&
            String(event.taskId || '') === runtime.taskId
        )
        const firstToolCallIndex = events.findIndex(
          (event) =>
            event.type === 'tool_call_started' &&
            event.toolName === 'terminal_run_command' &&
            String(event.taskId || '') === runtime.taskId
        )
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
          id: 'human.skills.workspace-shell-loaded-first',
          pass: skillLoadIndex >= 0 && firstToolCallIndex > skillLoadIndex,
          details: `skillLoadIndex=${skillLoadIndex}, firstToolCallIndex=${firstToolCallIndex}`
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

    const report = await readLatestCaseReportArtifacts('main-ai-human-live', CASE_ID)
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.signals.finalHumanAction).toBe('complete_task')
    expect(report.signals.skillActivationSequence[0]).toBe('workspace-shell')
  })
})

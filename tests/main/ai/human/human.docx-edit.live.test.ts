import { access } from 'node:fs/promises'
import path from 'node:path'
import * as mammoth from 'mammoth'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')
const CASE_ID = 'human-docx-edit'
const CASE_METADATA = {
  description: '验证 human 子图在真实模型下加载 docx skill 并完成 open/search/apply/save 流程。',
  taskGoal:
    '请修改当前 workspace 中的 input.docx：把文本 Hello 替换为 Hi from human，并保存为 output.docx。你可以按需加载能力；完成任务时 resultData 必须包含 out_path 字段。',
  scenarioTags: ['human', 'docx', 'progressive-skill'],
  expectedOutcome: 'success',
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: ['human-default']
} as const

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())(
    'human 应能渐进式加载 docx skill 并完成编辑保存',
    async () => {
      await runHumanCase({
        caseId: CASE_ID,
        description: CASE_METADATA.description,
        objective: CASE_METADATA.taskGoal,
        caseMetadata: CASE_METADATA,
        expectedOutcome: CASE_METADATA.expectedOutcome,
        scenarioTags: CASE_METADATA.scenarioTags,
        requiredFixtures: CASE_METADATA.requiredFixtures,
        fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
        approvalPolicy: 'auto-approve',
        maxSteps: 14,
        assert: async (result, runtime) => {
          const events = runtime.eventCollector.snapshot()
          const outputPath = path.join(runtime.workspaceRoot, 'output.docx')
          const loadedDocxSkill = events.some(
            (event) =>
              event.type === 'human_step' &&
              event.action === 'load_skill' &&
              event.skillId === 'docx-editing' &&
              String(event.taskId || '') === runtime.taskId
          )
          const openedDocx = events.some(
            (event) =>
              event.type === 'tool_call_started' &&
              event.toolName === 'docx_open' &&
              String(event.taskId || '') === runtime.taskId
          )
          const savedDocx = events.some(
            (event) =>
              event.type === 'tool_call_started' &&
              event.toolName === 'docx_save' &&
              String(event.taskId || '') === runtime.taskId
          )

          await access(outputPath)
          const rendered = await mammoth.extractRawText({ path: outputPath })

          recordAssertion(runtime.assertions, {
            id: 'human.status.completed',
            pass: result.status === 'completed',
            details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
          })
          recordAssertion(runtime.assertions, {
            id: 'human.result.out-path',
            pass: String(result.resultData?.out_path || '').includes('output.docx'),
            details: JSON.stringify(result.resultData)
          })
          recordAssertion(runtime.assertions, {
            id: 'human.skills.docx-editing-loaded',
            pass: loadedDocxSkill,
            details: 'expected load_skill(docx-editing) before docx tool execution'
          })
          recordAssertion(runtime.assertions, {
            id: 'human.events.docx-open',
            pass: openedDocx,
            details: 'expected docx_open tool call'
          })
          recordAssertion(runtime.assertions, {
            id: 'human.events.docx-save',
            pass: savedDocx,
            details: 'expected docx_save tool call'
          })
          recordAssertion(runtime.assertions, {
            id: 'human.output.docx-updated',
            pass: rendered.value.includes('Hi from human'),
            details: rendered.value
          })
        }
      })

      const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
      expect(report.metrics.executionStatus).toBe('completed')
      expect(report.signals.finalHumanAction).toBe('complete_task')
      expect(report.signals.skillActivationSequence).toContain('docx-editing')
      expect(report.signals.resultDataKeys).toContain('out_path')
      expect(report.metrics.stepBudgetUsage ?? 1).toBeLessThanOrEqual(1)
      if ((report.metrics.toolErrorCount || 0) > 0) {
        expect(report.metrics.qualityGrade).toBe('soft_pass')
      } else {
        expect(['hard_pass', 'soft_pass']).toContain(report.metrics.qualityGrade)
      }
    },
    240000
  )
})

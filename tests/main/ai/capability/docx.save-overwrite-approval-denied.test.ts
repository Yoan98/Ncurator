import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-save-overwrite-approval-denied'
const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')
const CASE_METADATA = {
  description: '验证 docx 覆盖保存在审批拒绝时的失败路径输出。',
  expectedOutcome: 'blocked',
  scenarioTags: ['docx', 'safe-save', 'negative-path'],
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'docx-tooling'
} as const

type JsonRecord = Record<string, string | number | boolean | null | JsonRecord | JsonRecord[]>

const asRecord = (value: object | null): JsonRecord => {
  if (!value) return {}
  return value as JsonRecord
}

const asString = (value: string | number | boolean | null | JsonRecord | JsonRecord[]): string => {
  return String(value || '')
}

describe('capability/docx', () => {
  test('docx_save overwrite 在审批拒绝时应输出可定位证据', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [
        { from: FIXTURE_SOURCE, to: 'input.docx' },
        { from: FIXTURE_SOURCE, to: 'output.docx' }
      ],
      approvalPolicy: 'deny-medium-high',
      buildExecutionOutcome: (result) => {
        const code = asString(result.saveResult.code as JsonRecord[keyof JsonRecord]) || 'unknown'
        return {
          status: code === 'approval_denied' ? 'blocked' : code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(result.saveResult.error as JsonRecord[keyof JsonRecord]) || undefined
        }
      },
      execute: async (runtime) => {
        const built = buildDocxCapabilityTools({
          ctx: runtime.ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          safePreviewChars: 1400,
          emitActivity: (activity) => {
            runtime.ctx.sendEvent({
              type: 'activity',
              runId: runtime.runId,
              taskId: runtime.taskId,
              activityId: `activity-${Date.now().toString(36)}`,
              actionType: activity.actionType,
              status: activity.status,
              summary: activity.summary,
              createdAt: Date.now()
            })
          }
        })

        const openTool = built.tools.find((item) => String(item.name) === 'docx_open')
        const saveTool = built.tools.find((item) => String(item.name) === 'docx_save')
        if (!openTool || !saveTool) {
          throw new Error('docx_open/docx_save tool is missing')
        }

        const openResult = asRecord(
          (await openTool.invoke({ sourcePath: 'input.docx' })) as JsonRecord
        )
        const docId = asString(openResult.docId as JsonRecord[keyof JsonRecord])
        const saveResult = asRecord(
          (await saveTool.invoke({
            docId,
            outPath: 'output.docx',
            overwrite: true
          })) as JsonRecord
        )

        return {
          saveResult
        }
      },
      assert: async (result, runtime) => {
        const code = asString(result.saveResult.code as JsonRecord[keyof JsonRecord])
        recordAssertion(runtime.assertions, {
          id: 'save.approval-denied',
          pass: code === 'approval_denied',
          details: `code=${code}, error=${asString(result.saveResult.error as JsonRecord[keyof JsonRecord])}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    const denied = report.events.some(
      (event) =>
        event.type === 'approval_decision' &&
        event.approved === false &&
        String(event.taskId || '').includes(CASE_ID)
    )

    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.metrics.executionResultCode).toBe('approval_denied')
    expect(report.metrics.fileArtifactCount).toBe(0)
    expect(report.signals.expectedOutcome).toBe('blocked')
    expect(report.signals.scenarioTags).toContain('safe-save')
    expect(report.signals.toolResultCodeCounts.docx_save?.approval_denied).toBe(1)
    expect(denied).toBe(true)
    expect(report.summary).toContain('executionResultCode: approval_denied')
  })
})

import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')
const INVALID_PATH_CASE_ID = 'docx-open-path-boundary-invalid-input'
const SAVE_NO_OVERWRITE_CASE_ID = 'docx-save-existing-without-overwrite'
const DOCX_BOUNDARY_BASE_METADATA = {
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'docx-tooling'
} as const
const INVALID_PATH_CASE_METADATA = {
  ...DOCX_BOUNDARY_BASE_METADATA,
  description: '验证 docx_open 对非法路径、越界路径、非 docx 路径的拒绝行为。',
  expectedOutcome: 'failure',
  scenarioTags: ['docx', 'boundary', 'negative-path'],
  requiredFixtures: []
} as const
const SAVE_NO_OVERWRITE_CASE_METADATA = {
  ...DOCX_BOUNDARY_BASE_METADATA,
  description: '验证 docx_save 在目标文件已存在且 overwrite=false 时直接失败，不触发审批。',
  expectedOutcome: 'failure',
  scenarioTags: ['docx', 'safe-save', 'negative-path'],
  requiredFixtures: [FIXTURE_SOURCE]
} as const

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: JsonValue | undefined): string => {
  return String(value || '')
}

const asBoolean = (value: JsonValue | undefined): boolean => {
  return value === true
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

describe('capability/docx boundary', () => {
  test('docx_open should reject invalid and out-of-workspace paths', async () => {
    await runCapabilityCase({
      caseId: INVALID_PATH_CASE_ID,
      description: INVALID_PATH_CASE_METADATA.description,
      caseMetadata: INVALID_PATH_CASE_METADATA,
      expectedOutcome: INVALID_PATH_CASE_METADATA.expectedOutcome,
      scenarioTags: INVALID_PATH_CASE_METADATA.scenarioTags,
      requiredFixtures: INVALID_PATH_CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const code = asString(asRecord(result.escapePathResult).code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: `escape=${code}, absolute=${asString(asRecord(result.absolutePathResult).code)}`
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

        const openTool = getToolByName(built.tools, 'docx_open')
        const escapePathResult = asRecord(
          (await openTool.invoke({ sourcePath: '../outside.docx' })) as JsonValue
        )
        const absolutePathResult = asRecord(
          (await openTool.invoke({ sourcePath: '/tmp/outside.docx' })) as JsonValue
        )
        const nonDocxResult = asRecord((await openTool.invoke({ sourcePath: 'notes.txt' })) as JsonValue)

        return {
          escapePathResult,
          absolutePathResult,
          nonDocxResult
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.open.escape-path.invalid-input',
          pass:
            asBoolean(asRecord(result.escapePathResult).ok) === false &&
            asString(asRecord(result.escapePathResult).code) === 'invalid_input',
          details: JSON.stringify(asRecord(result.escapePathResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.open.absolute-path.invalid-input',
          pass:
            asBoolean(asRecord(result.absolutePathResult).ok) === false &&
            asString(asRecord(result.absolutePathResult).code) === 'invalid_input',
          details: JSON.stringify(asRecord(result.absolutePathResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.open.non-docx.invalid-input',
          pass:
            asBoolean(asRecord(result.nonDocxResult).ok) === false &&
            asString(asRecord(result.nonDocxResult).code) === 'invalid_input',
          details: JSON.stringify(asRecord(result.nonDocxResult))
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', INVALID_PATH_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('failed')
    expect(report.metrics.executionResultCode).toBe('invalid_input')
  })

  test('docx_save should reject existing output without overwrite flag and avoid approval requests', async () => {
    await runCapabilityCase({
      caseId: SAVE_NO_OVERWRITE_CASE_ID,
      description: SAVE_NO_OVERWRITE_CASE_METADATA.description,
      caseMetadata: SAVE_NO_OVERWRITE_CASE_METADATA,
      expectedOutcome: SAVE_NO_OVERWRITE_CASE_METADATA.expectedOutcome,
      scenarioTags: SAVE_NO_OVERWRITE_CASE_METADATA.scenarioTags,
      requiredFixtures: SAVE_NO_OVERWRITE_CASE_METADATA.requiredFixtures,
      fixtureCopies: [
        { from: FIXTURE_SOURCE, to: 'input.docx' },
        { from: FIXTURE_SOURCE, to: 'output.docx' }
      ],
      buildExecutionOutcome: (result) => {
        const code = asString(asRecord(result.saveResult).code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(asRecord(result.saveResult).error)
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

        const openTool = getToolByName(built.tools, 'docx_open')
        const saveTool = getToolByName(built.tools, 'docx_save')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const docId = asString(openResult.docId)
        const saveResult = asRecord(
          (await saveTool.invoke({
            docId,
            outPath: 'output.docx'
          })) as JsonValue
        )

        const approvalRequiredEvents = runtime.eventCollector
          .snapshot()
          .filter((event) => event.type === 'approval_required')

        return {
          openResult,
          saveResult,
          approvalRequiredCount: approvalRequiredEvents.length
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'docx.save-existing.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-existing.invalid-input',
          pass:
            asBoolean(asRecord(result.saveResult).ok) === false &&
            asString(asRecord(result.saveResult).code) === 'invalid_input' &&
            asString(asRecord(result.saveResult).error).includes('outPath already exists'),
          details: JSON.stringify(asRecord(result.saveResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-existing.no-approval-required',
          pass: Number(result.approvalRequiredCount) === 0,
          details: `approvalRequiredCount=${String(result.approvalRequiredCount)}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', SAVE_NO_OVERWRITE_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionResultCode).toBe('invalid_input')
    expect(report.metrics.approvalRequiredCount).toBe(0)
  })
})

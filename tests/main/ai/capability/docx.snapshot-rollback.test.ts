import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')
const CASE_ID = 'docx-snapshot-history-rollback'
const CASE_METADATA = {
  description:
    '验证 docx 草稿快照链与回滚能力：多次 apply 形成版本链，rollback 仅切换 docId，不落盘文件。',
  expectedOutcome: 'success',
  scenarioTags: ['docx', 'snapshot-history', 'rollback', 'confirm-before-save'],
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'docx-tooling'
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

const asNumber = (value: JsonValue | undefined): number => {
  return typeof value === 'number' ? value : Number(value || 0)
}

const asRecordArray = (value: JsonValue | undefined): JsonRecord[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const countFileArtifacts = (events: AiRunEvent[]): number => {
  return events.filter((event) => event.type === 'file_artifact').length
}

describe('capability/docx snapshot rollback', () => {
  test('docx snapshot history and rollback should support confirm-before-save flows', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const rollbackResult = asRecord(result.rollbackResult)
        const code = asString(rollbackResult.code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(rollbackResult.summary)
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
        const searchTool = getToolByName(built.tools, 'docx_search')
        const applyTool = getToolByName(built.tools, 'docx_apply_ops')
        const historyTool = getToolByName(built.tools, 'docx_get_history')
        const rollbackTool = getToolByName(built.tools, 'docx_rollback')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const originalDocId = asString(openResult.docId)

        const applyResult1 = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Greetings',
                replaceAll: true
              }
            ]
          })) as JsonValue
        )
        const draftDocId1 = asString(applyResult1.newDocId)

        const applyResult2 = asRecord(
          (await applyTool.invoke({
            docId: draftDocId1,
            ops: [
              {
                type: 'replace_text',
                query: 'fixture',
                replace: 'workspace fixture updated',
                replaceAll: true
              }
            ]
          })) as JsonValue
        )
        const draftDocId2 = asString(applyResult2.newDocId)

        const searchDraft2Result = asRecord(
          (await searchTool.invoke({
            docId: draftDocId2,
            query: 'workspace fixture updated',
            mode: 'literal'
          })) as JsonValue
        )

        const historyResult = asRecord(
          (await historyTool.invoke({
            docId: draftDocId2,
            maxDepth: 5
          })) as JsonValue
        )

        const rollbackResult = asRecord(
          (await rollbackTool.invoke({
            docId: draftDocId2,
            steps: 1
          })) as JsonValue
        )
        const revertedDocId = asString(rollbackResult.docId)

        const searchRevertedGreetingResult = asRecord(
          (await searchTool.invoke({
            docId: revertedDocId,
            query: 'Greetings',
            mode: 'literal'
          })) as JsonValue
        )
        const searchRevertedUpdatedResult = asRecord(
          (await searchTool.invoke({
            docId: revertedDocId,
            query: 'workspace fixture updated',
            mode: 'literal'
          })) as JsonValue
        )

        return {
          openResult,
          applyResult1,
          applyResult2,
          searchDraft2Result,
          historyResult,
          rollbackResult,
          searchRevertedGreetingResult,
          searchRevertedUpdatedResult,
          fileArtifactCount: countFileArtifacts(runtime.eventCollector.snapshot())
        }
      },
      assert: async (result, runtime) => {
        const historySnapshots = asRecordArray(asRecord(result.historyResult).snapshots)
        const draft2Matches = asRecordArray(asRecord(result.searchDraft2Result).matches)
        const revertedGreetingMatches = asRecordArray(asRecord(result.searchRevertedGreetingResult).matches)
        const revertedUpdatedMatches = asRecordArray(asRecord(result.searchRevertedUpdatedResult).matches)

        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.apply-step1-has-change-blocks',
          pass:
            asBoolean(asRecord(result.applyResult1).ok) &&
            asRecordArray(asRecord(result.applyResult1).changedBlocks).length > 0,
          details: JSON.stringify(asRecord(result.applyResult1))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.apply-step2-has-change-blocks',
          pass:
            asBoolean(asRecord(result.applyResult2).ok) &&
            asRecordArray(asRecord(result.applyResult2).changedBlocks).length > 0,
          details: JSON.stringify(asRecord(result.applyResult2))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.history-chain-complete',
          pass:
            historySnapshots.length === 3 &&
            asString(historySnapshots[0]?.docId) === asString(asRecord(result.applyResult2).newDocId) &&
            asString(historySnapshots[1]?.docId) === asString(asRecord(result.applyResult1).newDocId) &&
            asString(historySnapshots[2]?.docId) === asString(asRecord(result.openResult).docId),
          details: JSON.stringify(historySnapshots)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.draft2-search-hit',
          pass:
            asBoolean(asRecord(result.searchDraft2Result).ok) && draft2Matches.length > 0,
          details: JSON.stringify(asRecord(result.searchDraft2Result))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.reverted-has-first-change',
          pass:
            asBoolean(asRecord(result.searchRevertedGreetingResult).ok) &&
            revertedGreetingMatches.length > 0,
          details: JSON.stringify(asRecord(result.searchRevertedGreetingResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.reverted-clears-second-change',
          pass:
            asBoolean(asRecord(result.searchRevertedUpdatedResult).ok) &&
            revertedUpdatedMatches.length === 0,
          details: JSON.stringify(asRecord(result.searchRevertedUpdatedResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.rollback.not-saved-yet',
          pass:
            asBoolean(asRecord(result.rollbackResult).ok) &&
            asString(asRecord(result.rollbackResult).summary).includes('not saved') &&
            asNumber(result.fileArtifactCount) === 0,
          details: `summary=${asString(asRecord(result.rollbackResult).summary)}, fileArtifactCount=${String(result.fileArtifactCount)}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
    expect(report.signals.toolCounts.docx_get_history).toBe(1)
    expect(report.signals.toolCounts.docx_rollback).toBe(1)
    expect(report.metrics.fileArtifactCount).toBe(0)
  })
})

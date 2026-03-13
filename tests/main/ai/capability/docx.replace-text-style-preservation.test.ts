import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-replace-text-style-preservation'
const CASE_METADATA = {
  description:
    '验证 replace_text 对命中 run 做原位替换，保留目标 block 内样式并且不影响未命中 block。',
  expectedOutcome: 'success',
  scenarioTags: ['docx', 'replace-text', 'style-preservation', 'local-edit-safety'],
  requiredFixtures: [],
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

const asRecordArray = (value: JsonValue | undefined): JsonRecord[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const createStyledDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun('Alpha '),
              new TextRun({ text: 'Target', bold: true }),
              new TextRun({ text: ' Tail', italics: true })
            ]
          }),
          new Paragraph({
            children: [new TextRun('Unaffected body paragraph')]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

describe('capability/docx replace_text style preservation', () => {
  test('docx replace_text should preserve target run styles and leave untouched blocks unchanged', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const validateResult = asRecord(result.validateResult)
        const code = asString(validateResult.code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(validateResult.summary)
        }
      },
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'styled-input.docx')
        await writeFile(sourcePath, await createStyledDocxBuffer())

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
        const outlineTool = getToolByName(built.tools, 'docx_outline')
        const getBlockTool = getToolByName(built.tools, 'docx_get_block')
        const applyTool = getToolByName(built.tools, 'docx_apply_ops')
        const validateTool = getToolByName(built.tools, 'docx_validate')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'styled-input.docx' })) as JsonValue)
        const originalDocId = asString(openResult.docId)
        const outlineResult = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 20,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )

        const blocks = asRecordArray(outlineResult.blocks)
        const targetBlockId =
          asString(
            blocks.find((item) => asString(item.type) === 'paragraph' && asString(item.text).includes('Target'))
              ?.blockId
          ) || ''
        const untouchedBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Unaffected body paragraph')
            )?.blockId
          ) || ''

        if (!targetBlockId || !untouchedBlockId) {
          throw new Error('target or untouched paragraph block is missing')
        }

        const targetBefore = asRecord(
          (await getBlockTool.invoke({ docId: originalDocId, blockId: targetBlockId })) as JsonValue
        )
        const untouchedBefore = asRecord(
          (await getBlockTool.invoke({ docId: originalDocId, blockId: untouchedBlockId })) as JsonValue
        )

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'Target',
                replace: 'Goal',
                blockIds: [targetBlockId]
              }
            ]
          })) as JsonValue
        )
        const editedDocId = asString(applyResult.newDocId)

        const targetAfter = asRecord(
          (await getBlockTool.invoke({ docId: editedDocId, blockId: targetBlockId })) as JsonValue
        )
        const untouchedAfter = asRecord(
          (await getBlockTool.invoke({ docId: editedDocId, blockId: untouchedBlockId })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)

        return {
          openResult,
          targetBefore,
          untouchedBefore,
          applyResult,
          targetAfter,
          untouchedAfter,
          validateResult
        }
      },
      assert: async (result, runtime) => {
        const targetBeforeRuns = asRecordArray(asRecord(result.targetBefore).block.runs)
        const targetAfterRuns = asRecordArray(asRecord(result.targetAfter).block.runs)
        const untouchedBeforeBlock = JSON.stringify(asRecord(result.untouchedBefore).block)
        const untouchedAfterBlock = JSON.stringify(asRecord(result.untouchedAfter).block)
        const changedBlocks = asRecordArray(asRecord(result.applyResult).changedBlocks)

        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.target-before-structured-runs',
          pass:
            targetBeforeRuns.length === 3 &&
            asString(targetBeforeRuns[1]?.text) === 'Target' &&
            targetBeforeRuns[1]?.bold === true &&
            targetBeforeRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.targetBefore))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.changed-block-count',
          pass:
            asBoolean(asRecord(result.applyResult).ok) &&
            changedBlocks.length === 1 &&
            asString(changedBlocks[0]?.action) === 'replace_text',
          details: JSON.stringify(asRecord(result.applyResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.target-after-preserves-runs',
          pass:
            targetAfterRuns.length === 3 &&
            asString(asRecord(result.targetAfter).block.text) === 'Alpha Goal Tail' &&
            asString(targetAfterRuns[1]?.text) === 'Goal' &&
            targetAfterRuns[1]?.bold === true &&
            targetAfterRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.targetAfter))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.untouched-block-identical',
          pass: untouchedBeforeBlock === untouchedAfterBlock,
          details: `before=${untouchedBeforeBlock}\nafter=${untouchedAfterBlock}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.replace-style.validate-ok',
          pass: asBoolean(asRecord(result.validateResult).ok),
          details: JSON.stringify(asRecord(result.validateResult))
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
  })
})

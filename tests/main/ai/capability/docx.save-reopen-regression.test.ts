import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-save-reopen-regression'
const CASE_METADATA = {
  description:
    '验证 docx 编辑结果保存后可再次打开，重复命中替换与多段 cell 结构在重开后仍保持正确。',
  expectedOutcome: 'success',
  scenarioTags: ['docx', 'save-reopen', 'replace-text', 'table-cell', 'regression'],
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

const createSaveReopenDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun('Stable Heading Anchor')]
          }),
          new Paragraph({
            children: [
              new TextRun('TOKEN alpha '),
              new TextRun({ text: 'TOKEN', bold: true }),
              new TextRun({ text: ' omega', italics: true })
            ]
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun('TOKEN in cell first line'),
                          new TextRun({ text: ' TOKEN', bold: true })
                        ]
                      }),
                      new Paragraph('Stable cell second line')
                    ]
                  }),
                  new TableCell({
                    children: [new Paragraph('Neighbor cell stable text')]
                  })
                ]
              })
            ]
          }),
          new Paragraph({
            children: [new TextRun('Stable Closing Note')]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

describe('capability/docx save reopen regression', () => {
  test('saved docx should reopen with repeated replacements and multi-paragraph cell structure intact', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const saveResult = asRecord(result.saveResult)
        const validateResult = asRecord(result.validateResult)
        const code = asString(validateResult.code) || asString(saveResult.code) || 'unknown'
        return {
          status: code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(validateResult.summary || saveResult.summary)
        }
      },
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'save-reopen-input.docx')
        await writeFile(sourcePath, await createSaveReopenDocxBuffer())

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
        const saveTool = getToolByName(built.tools, 'docx_save')
        const validateTool = getToolByName(built.tools, 'docx_validate')

        const openResult = asRecord(
          (await openTool.invoke({ sourcePath: 'save-reopen-input.docx' })) as JsonValue
        )
        const originalDocId = asString(openResult.docId)

        const initialOutline = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 200,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = asRecordArray(initialOutline.blocks)

        const targetParagraphId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('TOKEN alpha')
            )?.blockId
          ) || ''
        const targetCellId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'table_cell' &&
                asString(item.text).includes('TOKEN in cell first line')
            )?.blockId
          ) || ''
        const stableHeadingId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable Heading Anchor')
            )?.blockId
          ) || ''

        if (!targetParagraphId || !targetCellId || !stableHeadingId) {
          throw new Error('target block ids missing for save-reopen regression')
        }

        const headingBefore = asRecord(
          (await getBlockTool.invoke({
            docId: originalDocId,
            blockId: stableHeadingId
          })) as JsonValue
        )

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'TOKEN',
                replace: 'VALUE',
                replaceAll: true,
                blockIds: [targetParagraphId, targetCellId]
              }
            ]
          })) as JsonValue
        )
        const editedDocId = asString(applyResult.newDocId)

        const saveResult = asRecord(
          (await saveTool.invoke({
            docId: editedDocId,
            outPath: 'save-reopen-output.docx'
          })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)

        const reopenedOpenResult = asRecord(
          (await openTool.invoke({ sourcePath: 'save-reopen-output.docx' })) as JsonValue
        )
        const reopenedDocId = asString(reopenedOpenResult.docId)
        const reopenedOutline = asRecord(
          (await outlineTool.invoke({
            docId: reopenedDocId,
            maxBlocks: 220,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const reopenedBlocks = asRecordArray(reopenedOutline.blocks)
        const reopenedParagraphId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('VALUE alpha')
            )?.blockId
          ) || ''
        const reopenedCellId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'table_cell' &&
                asString(item.text).includes('VALUE in cell first line')
            )?.blockId
          ) || ''
        const reopenedHeadingId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable Heading Anchor')
            )?.blockId
          ) || ''

        if (!reopenedParagraphId || !reopenedCellId || !reopenedHeadingId) {
          throw new Error('reopened target block ids missing for save-reopen regression')
        }

        const reopenedParagraph = asRecord(
          (await getBlockTool.invoke({
            docId: reopenedDocId,
            blockId: reopenedParagraphId
          })) as JsonValue
        )
        const reopenedCell = asRecord(
          (await getBlockTool.invoke({
            docId: reopenedDocId,
            blockId: reopenedCellId
          })) as JsonValue
        )
        const reopenedHeading = asRecord(
          (await getBlockTool.invoke({
            docId: reopenedDocId,
            blockId: reopenedHeadingId
          })) as JsonValue
        )

        return {
          openResult,
          headingBefore,
          applyResult,
          saveResult,
          validateResult,
          reopenedOpenResult,
          reopenedParagraph,
          reopenedCell,
          reopenedHeading
        }
      },
      assert: async (result, runtime) => {
        const changedBlocks = asRecordArray(asRecord(result.applyResult).changedBlocks)
        const reopenedParagraphRuns = asRecordArray(asRecord(result.reopenedParagraph).block.runs)
        const reopenedCellParagraphs = asRecordArray(asRecord(result.reopenedCell).block.paragraphs)
        const headingBefore = JSON.stringify(asRecord(result.headingBefore).block)
        const reopenedHeading = JSON.stringify(asRecord(result.reopenedHeading).block)

        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.open-ok',
          pass:
            asBoolean(asRecord(result.openResult).ok) &&
            asBoolean(asRecord(result.reopenedOpenResult).ok),
          details: JSON.stringify({
            open: asRecord(result.openResult),
            reopened: asRecord(result.reopenedOpenResult)
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.apply-changed-two-blocks',
          pass:
            asBoolean(asRecord(result.applyResult).ok) &&
            changedBlocks.length === 2 &&
            changedBlocks.every((item) => asString(item.action) === 'replace_text'),
          details: JSON.stringify(asRecord(result.applyResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.saved-validate-ok',
          pass:
            asBoolean(asRecord(result.saveResult).ok) &&
            asBoolean(asRecord(result.validateResult).ok),
          details: JSON.stringify({
            save: asRecord(result.saveResult),
            validate: asRecord(result.validateResult)
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.paragraph-reopen-correct',
          pass:
            asString(asRecord(result.reopenedParagraph).block.text) === 'VALUE alpha VALUE omega' &&
            reopenedParagraphRuns.length === 3 &&
            asString(reopenedParagraphRuns[1]?.text) === 'VALUE' &&
            reopenedParagraphRuns[1]?.bold === true &&
            reopenedParagraphRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.reopenedParagraph))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.cell-structure-intact',
          pass:
            reopenedCellParagraphs.length === 2 &&
            asString(reopenedCellParagraphs[0]?.text) === 'VALUE in cell first line VALUE' &&
            asString(reopenedCellParagraphs[1]?.text) === 'Stable cell second line',
          details: JSON.stringify(asRecord(result.reopenedCell))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save-reopen.heading-unchanged',
          pass: headingBefore === reopenedHeading,
          details: `before=${headingBefore}\nafter=${reopenedHeading}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
  })
})

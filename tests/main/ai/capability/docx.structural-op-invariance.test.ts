import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-structural-op-invariance'

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonRecord | JsonValue[]
type JsonRecord = {
  [key: string]: JsonValue
}

type BlockRef = {
  type: string
  textNeedle: string
}

type CanonicalJson = JsonValue

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

const canonicalizeBlock = (value: JsonValue | undefined): CanonicalJson => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeBlock(item)) as JsonValue[]
  }
  if (!value || typeof value !== 'object') {
    return value ?? null
  }

  const source = value as JsonRecord
  const out: JsonRecord = {}
  for (const [key, nested] of Object.entries(source)) {
    if (key === 'blockId' || key === 'tableBlockId') continue
    out[key] = canonicalizeBlock(nested)
  }
  return out
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const createStructuralDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun('Stable Intro Alpha')
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('Target Replace Paragraph'),
              new TextRun({ text: ' with style tail', italics: true })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Anchor Insert Paragraph', bold: true })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('Delete Paragraph Marker')
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('Stable Middle Beta')
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
                    children: [new Paragraph('Target Cell Original')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Stable Cell Delta')]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Stable Cell Echo')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Stable Cell Foxtrot')]
                  })
                ]
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('Stable Outro Gamma')
            ]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

const snapshotByAnchors = async (input: {
  getBlockTool: StructuredToolInterface
  outlineTool: StructuredToolInterface
  docId: string
  refs: BlockRef[]
}): Promise<Record<string, string>> => {
  const outlineResult = asRecord(
    (await input.outlineTool.invoke({
      docId: input.docId,
      maxBlocks: 200,
      includeTables: true,
      includeCells: true
    })) as JsonValue
  )
  const blocks = asRecordArray(outlineResult.blocks)
  const out: Record<string, string> = {}

  for (const ref of input.refs) {
    const block =
      blocks.find(
        (item) =>
          asString(item.type) === ref.type &&
          asString(item.text || item.preview).includes(ref.textNeedle)
      ) || null
    if (!block) {
      throw new Error(`block not found for ${ref.type}:${ref.textNeedle}`)
    }
    const detail = asRecord(
      (await input.getBlockTool.invoke({
        docId: input.docId,
        blockId: asString(block.blockId)
      })) as JsonValue
    )
    out[`${ref.type}:${ref.textNeedle}`] = JSON.stringify(
      canonicalizeBlock(asRecord(detail.block))
    )
  }

  return out
}

describe('capability/docx structural op invariance', () => {
  test('structural operations should keep non-target blocks unchanged in a multi-block docx', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description:
        '验证 replace_block / insert_before / insert_after / update_table_cell / delete_block 在复杂文档里不会污染未命中 block。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'structural-ops', 'invariance', 'local-edit-safety'],
      requiredFixtures: [],
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
        const sourcePath = path.join(runtime.workspaceRoot, 'structural-input.docx')
        await writeFile(sourcePath, await createStructuralDocxBuffer())

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

        const stableRefs: BlockRef[] = [
          { type: 'paragraph', textNeedle: 'Stable Intro Alpha' },
          { type: 'paragraph', textNeedle: 'Stable Middle Beta' },
          { type: 'paragraph', textNeedle: 'Stable Outro Gamma' },
          { type: 'table_cell', textNeedle: 'Stable Cell Delta' },
          { type: 'table_cell', textNeedle: 'Stable Cell Echo' },
          { type: 'table_cell', textNeedle: 'Stable Cell Foxtrot' }
        ]

        const openResult = asRecord(
          (await openTool.invoke({ sourcePath: 'structural-input.docx' })) as JsonValue
        )
        const originalDocId = asString(openResult.docId)
        const beforeStableSnapshot = await snapshotByAnchors({
          getBlockTool,
          outlineTool,
          docId: originalDocId,
          refs: stableRefs
        })

        const initialOutline = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 200,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = asRecordArray(initialOutline.blocks)
        const replaceBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Target Replace Paragraph')
            )?.blockId
          ) || ''
        const insertAnchorId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Anchor Insert Paragraph')
            )?.blockId
          ) || ''
        const deleteBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Delete Paragraph Marker')
            )?.blockId
          ) || ''
        const targetCellId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'table_cell' &&
                asString(item.text).includes('Target Cell Original')
            )?.blockId
          ) || ''

        if (!replaceBlockId || !insertAnchorId || !deleteBlockId || !targetCellId) {
          throw new Error('target block ids missing for structural invariance test')
        }

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_block',
                blockId: replaceBlockId,
                content: {
                  kind: 'paragraph',
                  runs: [{ text: 'Target Replace Paragraph Updated' }]
                }
              },
              {
                type: 'insert_before',
                anchorBlockId: insertAnchorId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted Before Anchor' }]
                  }
                ]
              },
              {
                type: 'insert_after',
                anchorBlockId: insertAnchorId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted After Anchor' }]
                  }
                ]
              },
              {
                type: 'update_table_cell',
                blockId: targetCellId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Target Cell Updated' }]
                  }
                ]
              },
              {
                type: 'delete_block',
                blockId: deleteBlockId
              }
            ]
          })) as JsonValue
        )
        const editedDocId = asString(applyResult.newDocId)

        const afterStableSnapshot = await snapshotByAnchors({
          getBlockTool,
          outlineTool,
          docId: editedDocId,
          refs: stableRefs
        })
        const finalOutline = asRecord(
          (await outlineTool.invoke({
            docId: editedDocId,
            maxBlocks: 240,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const finalBlocks = asRecordArray(finalOutline.blocks)
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)

        return {
          openResult,
          applyResult,
          beforeStableSnapshot,
          afterStableSnapshot,
          finalBlocks,
          validateResult
        }
      },
      assert: async (result, runtime) => {
        const changedBlocks = asRecordArray(asRecord(result.applyResult).changedBlocks)
        const beforeStableSnapshot = asRecord(result.beforeStableSnapshot)
        const afterStableSnapshot = asRecord(result.afterStableSnapshot)
        const finalBlocks = asRecordArray(result.finalBlocks)
        const finalTexts = finalBlocks.map((item) => asString(item.text || item.preview))

        recordAssertion(runtime.assertions, {
          id: 'docx.structural.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.structural.changed-block-count',
          pass:
            asBoolean(asRecord(result.applyResult).ok) &&
            changedBlocks.length >= 5,
          details: JSON.stringify(asRecord(result.applyResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.structural.stable-blocks-identical',
          pass: JSON.stringify(beforeStableSnapshot) === JSON.stringify(afterStableSnapshot),
          details: `before=${JSON.stringify(beforeStableSnapshot)}\nafter=${JSON.stringify(afterStableSnapshot)}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.structural.insertions-present',
          pass:
            finalTexts.some((text) => text.includes('Inserted Before Anchor')) &&
            finalTexts.some((text) => text.includes('Inserted After Anchor')) &&
            finalTexts.some((text) => text.includes('Target Cell Updated')),
          details: JSON.stringify(finalTexts)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.structural.delete-removed',
          pass: finalTexts.every((text) => !text.includes('Delete Paragraph Marker')),
          details: JSON.stringify(finalTexts)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.structural.validate-ok',
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

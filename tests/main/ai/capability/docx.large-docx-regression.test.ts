import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import {
  AlignmentType,
  Document,
  LevelFormat,
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

const CASE_ID = 'docx-large-mixed-regression'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const CASE_METADATA = {
  description:
    '验证包含编号、样式、表格与插入/删除混合编辑的大型 docx，在保存重开后仍保持结构稳定。',
  expectedOutcome: 'success',
  scenarioTags: ['docx', 'large-docx', 'mixed-regression', 'save-reopen'],
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

const createLargeRegressionDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'main-numbering',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 260 }
                }
              }
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.START,
              style: {
                paragraph: {
                  indent: { left: 1440, hanging: 260 }
                }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun('Release Plan 2026')]
          }),
          new Paragraph({
            text: 'Stable Numbered Item One',
            numbering: {
              reference: 'main-numbering',
              level: 0
            }
          }),
          new Paragraph({
            text: 'Stable Numbered Item Two',
            numbering: {
              reference: 'main-numbering',
              level: 0
            }
          }),
          new Paragraph({
            text: 'Stable Numbered Child Item',
            numbering: {
              reference: 'main-numbering',
              level: 1
            }
          }),
          new Paragraph({
            children: [
              new TextRun('Styled target intro '),
              new TextRun({ text: 'KEEP_ME', bold: true }),
              new TextRun({ text: ' and trailing note', italics: true })
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
                    children: [new Paragraph('Header A')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Header B')]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('Target complex cell')]
                  }),
                  new TableCell({
                    children: [new Paragraph('Stable large table cell')]
                  })
                ]
              })
            ]
          }),
          new Paragraph({
            children: [new TextRun({ text: 'Anchor section for inserts', underline: {} })]
          }),
          new Paragraph({
            children: [new TextRun('Delete large paragraph marker')]
          }),
          new Paragraph({
            children: [new TextRun('Stable Appendix Note')]
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

const isElementNode = (value: Node | null): value is Element => {
  return value !== null && value.nodeType === 1
}

const collectParagraphText = (paragraph: Element): string => {
  let text = ''
  const stack: Node[] = [paragraph]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.nodeType === 3) {
      text += current.nodeValue || ''
      continue
    }
    if (!isElementNode(current)) continue
    const children = current.childNodes
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index)
      if (child) stack.push(child)
    }
  }
  return text
}

const paragraphHasNumbering = (doc: Document, textNeedle: string): boolean => {
  const paragraphs = doc.getElementsByTagNameNS(WORD_NS, 'p')
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs.item(index)
    if (!paragraph) continue
    if (!collectParagraphText(paragraph).includes(textNeedle)) continue
    const pPrList = paragraph.getElementsByTagNameNS(WORD_NS, 'pPr')
    if (pPrList.length === 0) return false
    const pPr = pPrList.item(0)
    if (!pPr) return false
    return pPr.getElementsByTagNameNS(WORD_NS, 'numPr').length > 0
  }
  return false
}

const loadDocumentXml = async (filePath: string): Promise<Document> => {
  const buffer = await readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('word/document.xml missing in saved docx')
  const xml = await file.async('text')
  return new DOMParser().parseFromString(xml, 'application/xml')
}

describe('capability/docx large regression', () => {
  test('large mixed docx regression should preserve numbering and untouched structures after local edits', async () => {
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
        const sourcePath = path.join(runtime.workspaceRoot, 'large-regression-input.docx')
        await writeFile(sourcePath, await createLargeRegressionDocxBuffer())

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

        const stableRefs: BlockRef[] = [
          { type: 'paragraph', textNeedle: 'Stable Numbered Item One' },
          { type: 'paragraph', textNeedle: 'Stable Numbered Item Two' },
          { type: 'paragraph', textNeedle: 'Stable Numbered Child Item' },
          { type: 'paragraph', textNeedle: 'Stable Appendix Note' },
          { type: 'table_cell', textNeedle: 'Stable large table cell' }
        ]

        const openResult = asRecord(
          (await openTool.invoke({ sourcePath: 'large-regression-input.docx' })) as JsonValue
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
            maxBlocks: 220,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = asRecordArray(initialOutline.blocks)

        const targetStyledBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('KEEP_ME')
            )?.blockId
          ) || ''
        const anchorBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Anchor section for inserts')
            )?.blockId
          ) || ''
        const deleteBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Delete large paragraph marker')
            )?.blockId
          ) || ''
        const targetCellId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'table_cell' &&
                asString(item.text).includes('Target complex cell')
            )?.blockId
          ) || ''

        if (!targetStyledBlockId || !anchorBlockId || !deleteBlockId || !targetCellId) {
          throw new Error('target block ids missing for large regression test')
        }

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'KEEP_ME',
                replace: 'PATCHED_KEEP',
                blockIds: [targetStyledBlockId]
              },
              {
                type: 'insert_before',
                anchorBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted large before anchor' }]
                  }
                ]
              },
              {
                type: 'insert_after',
                anchorBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Inserted large after anchor' }]
                  }
                ]
              },
              {
                type: 'update_table_cell',
                blockId: targetCellId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Target complex cell updated' }]
                  },
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Follow-up note preserved separately' }]
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
        const targetAfter = asRecord(
          (await getBlockTool.invoke({
            docId: editedDocId,
            blockId: targetStyledBlockId
          })) as JsonValue
        )
        const finalOutline = asRecord(
          (await outlineTool.invoke({
            docId: editedDocId,
            maxBlocks: 240,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const saveResult = asRecord(
          (await saveTool.invoke({
            docId: editedDocId,
            outPath: 'large-regression-output.docx'
          })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)

        const savedDoc = await loadDocumentXml(path.join(runtime.workspaceRoot, 'large-regression-output.docx'))

        return {
          openResult,
          applyResult,
          beforeStableSnapshot,
          afterStableSnapshot,
          targetAfter,
          finalBlocks: asRecordArray(finalOutline.blocks),
          saveResult,
          validateResult,
          numberingPreserved: {
            one: paragraphHasNumbering(savedDoc, 'Stable Numbered Item One'),
            two: paragraphHasNumbering(savedDoc, 'Stable Numbered Item Two'),
            child: paragraphHasNumbering(savedDoc, 'Stable Numbered Child Item')
          }
        }
      },
      assert: async (result, runtime) => {
        const targetAfterRuns = asRecordArray(asRecord(result.targetAfter).block.runs)
        const changedBlocks = asRecordArray(asRecord(result.applyResult).changedBlocks)
        const finalBlocks = asRecordArray(result.finalBlocks)
        const finalTexts = finalBlocks.map((item) => asString(item.text || item.preview))
        const numberingPreserved = asRecord(result.numberingPreserved)

        recordAssertion(runtime.assertions, {
          id: 'docx.large.open-ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.apply-ok',
          pass:
            asBoolean(asRecord(result.applyResult).ok) &&
            changedBlocks.length >= 5,
          details: JSON.stringify(asRecord(result.applyResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.stable-snapshot-identical',
          pass:
            JSON.stringify(asRecord(result.beforeStableSnapshot)) ===
            JSON.stringify(asRecord(result.afterStableSnapshot)),
          details: `before=${JSON.stringify(asRecord(result.beforeStableSnapshot))}\nafter=${JSON.stringify(asRecord(result.afterStableSnapshot))}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.target-style-preserved',
          pass:
            asString(asRecord(result.targetAfter).block.text) ===
              'Styled target intro PATCHED_KEEP and trailing note' &&
            targetAfterRuns.length === 3 &&
            asString(targetAfterRuns[1]?.text) === 'PATCHED_KEEP' &&
            targetAfterRuns[1]?.bold === true &&
            targetAfterRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.targetAfter))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.numbering-preserved',
          pass:
            numberingPreserved.one === true &&
            numberingPreserved.two === true &&
            numberingPreserved.child === true,
          details: JSON.stringify(numberingPreserved)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.final-outline-contains-edits',
          pass:
            finalTexts.some((text) => text.includes('Inserted large before anchor')) &&
            finalTexts.some((text) => text.includes('Inserted large after anchor')) &&
            finalTexts.some((text) => text.includes('Target complex cell updated')) &&
            finalTexts.every((text) => !text.includes('Delete large paragraph marker')),
          details: JSON.stringify(finalTexts)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.save-ok',
          pass: asBoolean(asRecord(result.saveResult).ok),
          details: JSON.stringify(asRecord(result.saveResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.large.validate-ok',
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

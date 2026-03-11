import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import {
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  Packer,
  PageBreak,
  Paragraph,
  TextRun
} from 'docx'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-peripheral-structure-regression'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonRecord | JsonValue[]
type JsonRecord = {
  [key: string]: JsonValue
}

type PeripheralStructureSummary = {
  headerFiles: string[]
  footerFiles: string[]
  headerTexts: string[]
  footerTexts: string[]
  hyperlinkTargets: string[]
  pageBreakCount: number
  headerRelationshipCount: number
  footerRelationshipCount: number
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

const collectXmlText = (xml: string): string => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const textNodes = doc.getElementsByTagNameNS(WORD_NS, 't')
  let out = ''
  for (let index = 0; index < textNodes.length; index += 1) {
    const node = textNodes.item(index)
    if (!node?.textContent) continue
    out += node.textContent
  }
  return out
}

const createPeripheralDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph('Stable Header Title')]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph('Stable Footer Note')]
          })
        },
        children: [
          new Paragraph({
            children: [new TextRun('Stable body intro')]
          }),
          new Paragraph({
            children: [
              new ExternalHyperlink({
                link: 'https://example.com/tool-capability',
                children: [
                  new TextRun({
                    text: 'Stable capability hyperlink'
                  })
                ]
              })
            ]
          }),
          new Paragraph({
            children: [new TextRun('Page boundary start'), new PageBreak()]
          }),
          new Paragraph({
            children: [new TextRun('Stable page-two paragraph')]
          }),
          new Paragraph({
            children: [
              new TextRun('PERIPHERAL_TOKEN before '),
              new TextRun({ text: 'PERIPHERAL_TOKEN', bold: true }),
              new TextRun({ text: ' after', italics: true })
            ]
          }),
          new Paragraph({
            children: [new TextRun('Stable trailing body')]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

const inspectPeripheralStructures = async (filePath: string): Promise<PeripheralStructureSummary> => {
  const buffer = await readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const allFiles = Object.keys(zip.files)
  const headerFiles = allFiles.filter((name) => /^word\/header\d+\.xml$/.test(name)).sort()
  const footerFiles = allFiles.filter((name) => /^word\/footer\d+\.xml$/.test(name)).sort()
  const headerTexts: string[] = []
  const footerTexts: string[] = []

  for (const headerFile of headerFiles) {
    const xml = await zip.file(headerFile)?.async('text')
    if (!xml) continue
    headerTexts.push(collectXmlText(xml))
  }
  for (const footerFile of footerFiles) {
    const xml = await zip.file(footerFile)?.async('text')
    if (!xml) continue
    footerTexts.push(collectXmlText(xml))
  }

  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('text')) || ''
  const relationshipMatches = Array.from(
    relsXml.matchAll(/<Relationship\b[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"(?:[^>]*TargetMode="([^"]+)")?/g)
  )
  const hyperlinkTargets = relationshipMatches
    .filter((match) => match[1]?.includes('/hyperlink') && match[3] === 'External')
    .map((match) => String(match[2] || ''))
  const headerRelationshipCount = relationshipMatches.filter((match) =>
    match[1]?.includes('/header')
  ).length
  const footerRelationshipCount = relationshipMatches.filter((match) =>
    match[1]?.includes('/footer')
  ).length

  const documentXml = (await zip.file('word/document.xml')?.async('text')) || ''
  const pageBreakCount = Array.from(documentXml.matchAll(/<w:br\b[^>]*w:type="page"/g)).length

  return {
    headerFiles,
    footerFiles,
    headerTexts,
    footerTexts,
    hyperlinkTargets,
    pageBreakCount,
    headerRelationshipCount,
    footerRelationshipCount
  }
}

describe('capability/docx peripheral structures', () => {
  test('body-local edits should preserve header footer hyperlink and page-break structures', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description:
        '验证正文局部编辑后保存并重开，页眉页脚、外部链接和分页符等外围结构仍保持完整。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'peripheral-structure', 'header-footer', 'hyperlink', 'page-break'],
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
        const sourcePath = path.join(runtime.workspaceRoot, 'peripheral-input.docx')
        await writeFile(sourcePath, await createPeripheralDocxBuffer())

        const beforeStructures = await inspectPeripheralStructures(sourcePath)
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
          (await openTool.invoke({ sourcePath: 'peripheral-input.docx' })) as JsonValue
        )
        const originalDocId = asString(openResult.docId)
        const outlineResult = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 160,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = asRecordArray(outlineResult.blocks)
        const targetBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('PERIPHERAL_TOKEN before')
            )?.blockId
          ) || ''
        const stableTrailingId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable trailing body')
            )?.blockId
          ) || ''

        if (!targetBlockId || !stableTrailingId) {
          throw new Error('peripheral regression target blocks are missing')
        }

        const stableBefore = asRecord(
          (await getBlockTool.invoke({
            docId: originalDocId,
            blockId: stableTrailingId
          })) as JsonValue
        )

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'PERIPHERAL_TOKEN',
                replace: 'UPDATED_TOKEN',
                replaceAll: true,
                blockIds: [targetBlockId]
              }
            ]
          })) as JsonValue
        )
        const editedDocId = asString(applyResult.newDocId)

        const saveResult = asRecord(
          (await saveTool.invoke({
            docId: editedDocId,
            outPath: 'peripheral-output.docx'
          })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)
        const afterStructures = await inspectPeripheralStructures(
          path.join(runtime.workspaceRoot, 'peripheral-output.docx')
        )

        const reopenedOpenResult = asRecord(
          (await openTool.invoke({ sourcePath: 'peripheral-output.docx' })) as JsonValue
        )
        const reopenedDocId = asString(reopenedOpenResult.docId)
        const reopenedOutline = asRecord(
          (await outlineTool.invoke({
            docId: reopenedDocId,
            maxBlocks: 160,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const reopenedBlocks = asRecordArray(reopenedOutline.blocks)
        const reopenedTargetId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('UPDATED_TOKEN before')
            )?.blockId
          ) || ''
        const reopenedStableTrailingId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable trailing body')
            )?.blockId
          ) || ''

        if (!reopenedTargetId || !reopenedStableTrailingId) {
          throw new Error('reopened peripheral regression blocks are missing')
        }

        const reopenedTarget = asRecord(
          (await getBlockTool.invoke({
            docId: reopenedDocId,
            blockId: reopenedTargetId
          })) as JsonValue
        )
        const stableAfter = asRecord(
          (await getBlockTool.invoke({
            docId: reopenedDocId,
            blockId: reopenedStableTrailingId
          })) as JsonValue
        )

        return {
          beforeStructures,
          openResult,
          stableBefore,
          applyResult,
          saveResult,
          validateResult,
          afterStructures,
          reopenedOpenResult,
          reopenedTarget,
          stableAfter
        }
      },
      assert: async (result, runtime) => {
        const beforeStructures = result.beforeStructures as PeripheralStructureSummary
        const afterStructures = result.afterStructures as PeripheralStructureSummary
        const reopenedTargetRuns = asRecordArray(asRecord(result.reopenedTarget).block.runs)
        const stableBefore = JSON.stringify(asRecord(result.stableBefore).block)
        const stableAfter = JSON.stringify(asRecord(result.stableAfter).block)

        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.open-save-validate-ok',
          pass:
            asBoolean(asRecord(result.openResult).ok) &&
            asBoolean(asRecord(result.saveResult).ok) &&
            asBoolean(asRecord(result.validateResult).ok) &&
            asBoolean(asRecord(result.reopenedOpenResult).ok),
          details: JSON.stringify({
            open: asRecord(result.openResult),
            save: asRecord(result.saveResult),
            validate: asRecord(result.validateResult),
            reopened: asRecord(result.reopenedOpenResult)
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.target-reopened-correct',
          pass:
            asString(asRecord(result.reopenedTarget).block.text) ===
              'UPDATED_TOKEN before UPDATED_TOKEN after' &&
            reopenedTargetRuns.length === 3 &&
            asString(reopenedTargetRuns[1]?.text) === 'UPDATED_TOKEN' &&
            reopenedTargetRuns[1]?.bold === true &&
            reopenedTargetRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.reopenedTarget))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.stable-body-unchanged',
          pass: stableBefore === stableAfter,
          details: `before=${stableBefore}\nafter=${stableAfter}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.headers-footers-preserved',
          pass:
            beforeStructures.headerFiles.length >= 1 &&
            beforeStructures.footerFiles.length >= 1 &&
            JSON.stringify(beforeStructures.headerTexts) === JSON.stringify(afterStructures.headerTexts) &&
            JSON.stringify(beforeStructures.footerTexts) === JSON.stringify(afterStructures.footerTexts) &&
            beforeStructures.headerRelationshipCount === afterStructures.headerRelationshipCount &&
            beforeStructures.footerRelationshipCount === afterStructures.footerRelationshipCount,
          details: JSON.stringify({
            before: beforeStructures,
            after: afterStructures
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.hyperlink-preserved',
          pass:
            beforeStructures.hyperlinkTargets.includes('https://example.com/tool-capability') &&
            JSON.stringify(beforeStructures.hyperlinkTargets) ===
              JSON.stringify(afterStructures.hyperlinkTargets),
          details: JSON.stringify({
            before: beforeStructures.hyperlinkTargets,
            after: afterStructures.hyperlinkTargets
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.peripheral.page-break-preserved',
          pass:
            beforeStructures.pageBreakCount >= 1 &&
            beforeStructures.pageBreakCount === afterStructures.pageBreakCount,
          details: JSON.stringify({
            before: beforeStructures.pageBreakCount,
            after: afterStructures.pageBreakCount
          })
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
  })
})

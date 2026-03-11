import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import {
  Document,
  ExternalHyperlink,
  Packer,
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

const CASE_ID = 'docx-target-hyperlink-preservation'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonRecord | JsonValue[]
type JsonRecord = {
  [key: string]: JsonValue
}

type HyperlinkStructureSummary = {
  hyperlinkTargets: string[]
  hyperlinkTexts: string[]
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

const createTargetHyperlinkDocxBuffer = async (): Promise<Buffer> => {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun('Stable hyperlink heading')]
          }),
          new Paragraph({
            children: [
              new TextRun('Prefix '),
              new ExternalHyperlink({
                link: 'https://example.com/target-link',
                children: [
                  new TextRun({
                    text: 'TOKEN_LINK',
                    bold: true
                  })
                ]
              }),
              new TextRun({ text: ' suffix', italics: true })
            ]
          }),
          new Paragraph({
            children: [new TextRun('Stable companion paragraph')]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

const collectNodeText = (node: Element): string => {
  let text = ''
  const stack: Node[] = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.nodeType === 3) {
      text += current.nodeValue || ''
      continue
    }
    if (current.nodeType !== 1) continue
    const element = current as Element
    const children = element.childNodes
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index)
      if (child) stack.push(child)
    }
  }
  return text
}

const inspectHyperlinkStructures = async (filePath: string): Promise<HyperlinkStructureSummary> => {
  const buffer = await readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('text')) || ''
  const hyperlinkTargets = Array.from(
    relsXml.matchAll(/<Relationship\b[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"(?:[^>]*TargetMode="([^"]+)")?/g)
  )
    .filter((match) => match[1]?.includes('/hyperlink') && match[3] === 'External')
    .map((match) => String(match[2] || ''))

  const documentXml = (await zip.file('word/document.xml')?.async('text')) || ''
  const documentDom = new DOMParser().parseFromString(documentXml, 'application/xml')
  const hyperlinkNodes = documentDom.getElementsByTagNameNS(WORD_NS, 'hyperlink')
  const hyperlinkTexts: string[] = []
  for (let index = 0; index < hyperlinkNodes.length; index += 1) {
    const node = hyperlinkNodes.item(index)
    if (!node || node.nodeType !== 1) continue
    hyperlinkTexts.push(collectNodeText(node as Element))
  }

  return {
    hyperlinkTargets,
    hyperlinkTexts
  }
}

describe('capability/docx target hyperlink preservation', () => {
  test('replace_text should preserve hyperlink structure when the edited text is inside the hyperlink', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description:
        '验证目标段落内的超链接文本被 replace_text 修改后，链接关系和链接节点仍保持完整。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'hyperlink', 'replace-text', 'save-reopen'],
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
        const sourcePath = path.join(runtime.workspaceRoot, 'hyperlink-target-input.docx')
        await writeFile(sourcePath, await createTargetHyperlinkDocxBuffer())

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
        const searchTool = getToolByName(built.tools, 'docx_search')
        const applyTool = getToolByName(built.tools, 'docx_apply_ops')
        const saveTool = getToolByName(built.tools, 'docx_save')
        const validateTool = getToolByName(built.tools, 'docx_validate')

        const beforeStructures = await inspectHyperlinkStructures(sourcePath)
        const openResult = asRecord(
          (await openTool.invoke({ sourcePath: 'hyperlink-target-input.docx' })) as JsonValue
        )
        const originalDocId = asString(openResult.docId)
        const outlineResult = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 120,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = asRecordArray(outlineResult.blocks)
        const searchResult = asRecord(
          (await searchTool.invoke({
            docId: originalDocId,
            query: 'TOKEN_LINK',
            mode: 'literal'
          })) as JsonValue
        )
        const searchMatches = asRecordArray(searchResult.matches)
        const targetBlockId = asString(searchMatches[0]?.blockId)
        const stableCompanionId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable companion paragraph')
            )?.blockId
          ) || ''

        if (!targetBlockId || !stableCompanionId) {
          throw new Error(
            `hyperlink target regression blocks are missing: target=${targetBlockId}, stable=${stableCompanionId}`
          )
        }

        const stableBefore = asRecord(
          (await getBlockTool.invoke({
            docId: originalDocId,
            blockId: stableCompanionId
          })) as JsonValue
        )

        const applyResult = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'TOKEN_LINK',
                replace: 'VALUE_LINK',
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
            outPath: 'hyperlink-target-output.docx'
          })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)
        const afterStructures = await inspectHyperlinkStructures(
          path.join(runtime.workspaceRoot, 'hyperlink-target-output.docx')
        )

        const reopenedOpenResult = asRecord(
          (await openTool.invoke({ sourcePath: 'hyperlink-target-output.docx' })) as JsonValue
        )
        const reopenedDocId = asString(reopenedOpenResult.docId)
        const reopenedOutline = asRecord(
          (await outlineTool.invoke({
            docId: reopenedDocId,
            maxBlocks: 120,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const reopenedBlocks = asRecordArray(reopenedOutline.blocks)
        const reopenedSearchResult = asRecord(
          (await searchTool.invoke({
            docId: reopenedDocId,
            query: 'VALUE_LINK',
            mode: 'literal'
          })) as JsonValue
        )
        const reopenedSearchMatches = asRecordArray(reopenedSearchResult.matches)
        const reopenedTargetId = asString(reopenedSearchMatches[0]?.blockId)
        const reopenedStableCompanionId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable companion paragraph')
            )?.blockId
          ) || ''

        if (!reopenedTargetId || !reopenedStableCompanionId) {
          throw new Error(
            `reopened hyperlink target regression blocks are missing: target=${reopenedTargetId}, stable=${reopenedStableCompanionId}`
          )
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
            blockId: reopenedStableCompanionId
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
        const beforeStructures = result.beforeStructures as HyperlinkStructureSummary
        const afterStructures = result.afterStructures as HyperlinkStructureSummary
        const stableBefore = JSON.stringify(asRecord(result.stableBefore).block)
        const stableAfter = JSON.stringify(asRecord(result.stableAfter).block)

        recordAssertion(runtime.assertions, {
          id: 'docx.hyperlink.open-save-validate-ok',
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
          id: 'docx.hyperlink.target-reopened-correct',
          pass:
            asString(asRecord(result.reopenedTarget).block.text) === 'Prefix VALUE_LINK suffix',
          details: JSON.stringify(asRecord(result.reopenedTarget))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.hyperlink.relationship-preserved',
          pass:
            beforeStructures.hyperlinkTargets.includes('https://example.com/target-link') &&
            JSON.stringify(beforeStructures.hyperlinkTargets) ===
              JSON.stringify(afterStructures.hyperlinkTargets),
          details: JSON.stringify({
            before: beforeStructures.hyperlinkTargets,
            after: afterStructures.hyperlinkTargets
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.hyperlink.node-text-updated',
          pass:
            beforeStructures.hyperlinkTexts.includes('TOKEN_LINK') &&
            afterStructures.hyperlinkTexts.includes('VALUE_LINK') &&
            !afterStructures.hyperlinkTexts.includes('TOKEN_LINK'),
          details: JSON.stringify({
            before: beforeStructures.hyperlinkTexts,
            after: afterStructures.hyperlinkTexts
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.hyperlink.stable-companion-unchanged',
          pass: stableBefore === stableAfter,
          details: `before=${stableBefore}\nafter=${stableAfter}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
  })
})

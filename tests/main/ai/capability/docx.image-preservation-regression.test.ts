import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { Document, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'docx-image-preservation-regression'
const IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7n6QAAAAASUVORK5CYII='

type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonRecord | JsonValue[]
type JsonRecord = {
  [key: string]: JsonValue
}

type ImageRelationshipSummary = {
  imageRelationshipCount: number
  missingTargets: string[]
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

const createImageDocxBuffer = async (): Promise<Buffer> => {
  const imageData = Buffer.from(IMAGE_PNG_BASE64, 'base64')
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun('Image preservation heading')]
          }),
          new Paragraph({
            children: [
              new ImageRun({
                data: imageData,
                transformation: {
                  width: 24,
                  height: 24
                }
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('Stable image companion text')
            ]
          }),
          new Paragraph({
            children: [
              new TextRun('TOKEN_IMAGE before '),
              new TextRun({ text: 'TOKEN_IMAGE', bold: true }),
              new TextRun({ text: ' after', italics: true })
            ]
          })
        ]
      }
    ]
  })
  return await Packer.toBuffer(doc)
}

const inspectImageRelationships = async (filePath: string): Promise<ImageRelationshipSummary> => {
  const buffer = await readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (!relsFile) {
    return {
      imageRelationshipCount: 0,
      missingTargets: []
    }
  }

  const relsXml = await relsFile.async('text')
  const relationshipMatches = Array.from(
    relsXml.matchAll(/<Relationship\b[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)
  )
  const imageTargets = relationshipMatches
    .filter((match) => match[1]?.includes('/image'))
    .map((match) => String(match[2] || ''))
  const missingTargets = imageTargets.filter((target) => {
    const normalized = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\/+/, '')}`
    return !zip.file(normalized)
  })

  return {
    imageRelationshipCount: imageTargets.length,
    missingTargets
  }
}

describe('capability/docx image preservation', () => {
  test('local text edits should preserve image relationships after save and reopen', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description:
        '验证包含图片关系的 docx 在局部文本编辑后保存并重开，图片关系和目标文件仍然保持完整。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'image-preservation', 'relationships', 'save-reopen'],
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
        const sourcePath = path.join(runtime.workspaceRoot, 'image-input.docx')
        await writeFile(sourcePath, await createImageDocxBuffer())

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
          (await openTool.invoke({ sourcePath: 'image-input.docx' })) as JsonValue
        )
        const originalDocId = asString(openResult.docId)

        const initialOutline = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 120,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const blocks = (Array.isArray(initialOutline.blocks) ? initialOutline.blocks : []) as JsonRecord[]
        const targetBlockId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('TOKEN_IMAGE before')
            )?.blockId
          ) || ''
        const stableCompanionId =
          asString(
            blocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable image companion text')
            )?.blockId
          ) || ''

        if (!targetBlockId || !stableCompanionId) {
          throw new Error('image regression target blocks are missing')
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
                query: 'TOKEN_IMAGE',
                replace: 'VALUE_IMAGE',
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
            outPath: 'image-output.docx'
          })) as JsonValue
        )
        const validateResult = asRecord((await validateTool.invoke({ docId: editedDocId })) as JsonValue)

        const reopenedOpenResult = asRecord(
          (await openTool.invoke({ sourcePath: 'image-output.docx' })) as JsonValue
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
        const reopenedBlocks = (Array.isArray(reopenedOutline.blocks)
          ? reopenedOutline.blocks
          : []) as JsonRecord[]
        const reopenedTargetId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('VALUE_IMAGE before')
            )?.blockId
          ) || ''
        const reopenedStableCompanionId =
          asString(
            reopenedBlocks.find(
              (item) =>
                asString(item.type) === 'paragraph' &&
                asString(item.text).includes('Stable image companion text')
            )?.blockId
          ) || ''

        if (!reopenedTargetId || !reopenedStableCompanionId) {
          throw new Error('reopened image regression blocks are missing')
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
        const imageRelationships = await inspectImageRelationships(
          path.join(runtime.workspaceRoot, 'image-output.docx')
        )

        return {
          openResult,
          stableBefore,
          applyResult,
          saveResult,
          validateResult,
          reopenedOpenResult,
          reopenedTarget,
          stableAfter,
          imageRelationships
        }
      },
      assert: async (result, runtime) => {
        const reopenedTargetRuns = asRecordArray(asRecord(result.reopenedTarget).block.runs)
        const stableBefore = JSON.stringify(asRecord(result.stableBefore).block)
        const stableAfter = JSON.stringify(asRecord(result.stableAfter).block)
        const imageRelationships = asRecord(result.imageRelationships)

        recordAssertion(runtime.assertions, {
          id: 'docx.image.open-ok',
          pass:
            asBoolean(asRecord(result.openResult).ok) &&
            asBoolean(asRecord(result.reopenedOpenResult).ok),
          details: JSON.stringify({
            open: asRecord(result.openResult),
            reopened: asRecord(result.reopenedOpenResult)
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.image.image-count-preserved',
          pass:
            String(asRecord(result.openResult).stats?.imageCount || '') === '1' &&
            String(asRecord(result.reopenedOpenResult).stats?.imageCount || '') === '1',
          details: JSON.stringify({
            beforeStats: asRecord(result.openResult).stats,
            afterStats: asRecord(result.reopenedOpenResult).stats
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.image.relationships-intact',
          pass:
            Number(imageRelationships.imageRelationshipCount || 0) >= 1 &&
            Array.isArray(imageRelationships.missingTargets) &&
            imageRelationships.missingTargets.length === 0,
          details: JSON.stringify(imageRelationships)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.image.target-reopened-correct',
          pass:
            asString(asRecord(result.reopenedTarget).block.text) ===
              'VALUE_IMAGE before VALUE_IMAGE after' &&
            reopenedTargetRuns.length === 3 &&
            asString(reopenedTargetRuns[1]?.text) === 'VALUE_IMAGE' &&
            reopenedTargetRuns[1]?.bold === true &&
            reopenedTargetRuns[2]?.italic === true,
          details: JSON.stringify(asRecord(result.reopenedTarget))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.image.stable-companion-unchanged',
          pass: stableBefore === stableAfter,
          details: `before=${stableBefore}\nafter=${stableAfter}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.image.save-validate-ok',
          pass:
            asBoolean(asRecord(result.saveResult).ok) &&
            asBoolean(asRecord(result.validateResult).ok),
          details: JSON.stringify({
            save: asRecord(result.saveResult),
            validate: asRecord(result.validateResult)
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

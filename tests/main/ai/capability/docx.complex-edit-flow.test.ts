import { access } from 'node:fs/promises'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, test } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { buildDocxCapabilityTools } from '../../../../src/main/services/ai/tools/docx/docxTools'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

type OutlineBlock = {
  blockId: string
  type: string
  text: string
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

const asStringArray = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string').map((item) => String(item))
}

const toOutlineBlocks = (value: JsonValue | undefined): OutlineBlock[] => {
  return asRecordArray(value).map((item) => ({
    blockId: asString(item.blockId),
    type: asString(item.type),
    text: asString(item.text || item.preview)
  }))
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const toolCallNames = (events: AiRunEvent[]): string[] => {
  return events
    .filter((event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> => {
      return event.type === 'tool_call_started'
    })
    .map((event) => event.toolName)
}

describe('capability/docx', () => {
  test('docx complex edit flow should support multi-op editing and full inspect-save-validate chain', async () => {
    await runCapabilityCase({
      caseId: 'docx-complex-edit-flow',
      description:
        '验证 docx 复杂编辑链路：open -> outline -> get_block -> apply multi ops -> search -> preview -> save -> validate。',
      expectedOutcome: 'success',
      scenarioTags: ['docx', 'complex-edit', 'tool-chain'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const saveResult = asRecord(result.saveResult)
        const validateResult = asRecord(result.validateResult)
        const saveCode = asString(saveResult.code)
        const validateCode = asString(validateResult.code)
        const resultCode = validateCode || saveCode || 'unknown'
        return {
          status: resultCode === 'ok' ? 'completed' : 'failed',
          resultCode,
          summary: `save=${saveCode || 'unknown'}, validate=${validateCode || 'unknown'}`
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
        const outlineTool = getToolByName(built.tools, 'docx_outline')
        const getBlockTool = getToolByName(built.tools, 'docx_get_block')
        const applyTool = getToolByName(built.tools, 'docx_apply_ops')
        const searchTool = getToolByName(built.tools, 'docx_search')
        const previewTool = getToolByName(built.tools, 'docx_render_preview')
        const saveTool = getToolByName(built.tools, 'docx_save')
        const validateTool = getToolByName(built.tools, 'docx_validate')

        const openResult = asRecord((await openTool.invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const originalDocId = asString(openResult.docId)

        const initialOutlineResult = asRecord(
          (await outlineTool.invoke({
            docId: originalDocId,
            maxBlocks: 200,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const initialBlocks = toOutlineBlocks(initialOutlineResult.blocks)
        const firstParagraphId = initialBlocks.find((block) => block.type === 'paragraph')?.blockId || ''
        if (!firstParagraphId) throw new Error('initial paragraph block is missing')

        const applyResult1 = asRecord(
          (await applyTool.invoke({
            docId: originalDocId,
            ops: [
              {
                type: 'replace_block',
                blockId: firstParagraphId,
                content: {
                  kind: 'paragraph',
                  runs: [{ text: 'Project Plan v1' }]
                }
              },
              {
                type: 'insert_before',
                anchorBlockId: firstParagraphId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Executive Summary' }]
                  }
                ]
              },
              {
                type: 'insert_after',
                anchorBlockId: firstParagraphId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Action Items' }]
                  },
                  {
                    kind: 'table',
                    rows: [
                      [
                        {
                          paragraphs: [
                            {
                              kind: 'paragraph',
                              runs: [{ text: 'Owner: TBD' }]
                            }
                          ]
                        },
                        {
                          paragraphs: [
                            {
                              kind: 'paragraph',
                              runs: [{ text: 'Status: Open' }]
                            }
                          ]
                        }
                      ]
                    ]
                  }
                ]
              },
              {
                type: 'replace_text',
                query: 'TBD',
                replace: 'Alice',
                replaceAll: true
              }
            ]
          })) as JsonValue
        )

        const editedDocId = asString(applyResult1.newDocId)

        const postApplyOutlineResult = asRecord(
          (await outlineTool.invoke({
            docId: editedDocId,
            maxBlocks: 300,
            includeTables: true,
            includeCells: true
          })) as JsonValue
        )
        const postApplyBlocks = toOutlineBlocks(postApplyOutlineResult.blocks)
        const ownerCellBlockId =
          postApplyBlocks.find(
            (block) => block.type === 'table_cell' && block.text.includes('Owner: Alice')
          )?.blockId || ''
        const actionItemsBlockId =
          postApplyBlocks.find(
            (block) => block.type === 'paragraph' && block.text.includes('Action Items')
          )?.blockId || ''

        if (!ownerCellBlockId) throw new Error('owner table cell block is missing')
        if (!actionItemsBlockId) throw new Error('action items paragraph block is missing')

        const getBlockResult = asRecord(
          (await getBlockTool.invoke({
            docId: editedDocId,
            blockId: ownerCellBlockId
          })) as JsonValue
        )

        const applyResult2 = asRecord(
          (await applyTool.invoke({
            docId: editedDocId,
            ops: [
              {
                type: 'update_table_cell',
                blockId: ownerCellBlockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: 'Owner: Alice (updated)' }]
                  }
                ]
              },
              {
                type: 'delete_block',
                blockId: actionItemsBlockId
              }
            ]
          })) as JsonValue
        )

        const finalDocId = asString(applyResult2.newDocId)

        const literalSearchResult = asRecord(
          (await searchTool.invoke({
            docId: finalDocId,
            query: 'Owner: Alice (updated)',
            mode: 'literal'
          })) as JsonValue
        )

        const regexSearchResult = asRecord(
          (await searchTool.invoke({
            docId: finalDocId,
            query: 'Executive\\s+Summary',
            mode: 'regex'
          })) as JsonValue
        )

        const previewResult = asRecord(
          (await previewTool.invoke({
            docId: finalDocId,
            format: 'html'
          })) as JsonValue
        )

        const saveResult = asRecord(
          (await saveTool.invoke({
            docId: finalDocId,
            outPath: 'output-complex.docx'
          })) as JsonValue
        )

        const validateResult = asRecord(
          (await validateTool.invoke({
            docId: finalDocId
          })) as JsonValue
        )

        await access(path.join(runtime.workspaceRoot, 'output-complex.docx'))

        return {
          openResult,
          initialOutlineResult,
          applyResult1,
          postApplyOutlineResult,
          getBlockResult,
          applyResult2,
          literalSearchResult,
          regexSearchResult,
          previewResult,
          saveResult,
          validateResult,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const initialBlocks = toOutlineBlocks(asRecord(result.initialOutlineResult).blocks)
        const changedBlocks1 = asRecordArray(asRecord(result.applyResult1).changedBlocks)
        const changedBlocks2 = asRecordArray(asRecord(result.applyResult2).changedBlocks)
        const literalMatches = asRecordArray(asRecord(result.literalSearchResult).matches)
        const regexMatches = asRecordArray(asRecord(result.regexSearchResult).matches)
        const previewPath = asString(asRecord(result.previewResult).previewPath)
        const validateProblems = asRecordArray(asRecord(result.validateResult).problems)
        const startedToolNames = toolCallNames(result.events as AiRunEvent[])

        recordAssertion(runtime.assertions, {
          id: 'docx.open.ok',
          pass: asBoolean(asRecord(result.openResult).ok),
          details: asString(asRecord(result.openResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.outline.initial-has-blocks',
          pass: initialBlocks.length > 0,
          details: `blockCount=${initialBlocks.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.apply.first.ok',
          pass: asBoolean(asRecord(result.applyResult1).ok) && changedBlocks1.length >= 3,
          details: `changedCount=${changedBlocks1.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.get-block.table-cell',
          pass:
            asBoolean(asRecord(result.getBlockResult).ok) &&
            asString(asRecord(asRecord(result.getBlockResult).block).type) === 'table_cell',
          details: JSON.stringify(asRecord(result.getBlockResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.apply.second.ok',
          pass: asBoolean(asRecord(result.applyResult2).ok) && changedBlocks2.length >= 1,
          details: `changedCount=${changedBlocks2.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.search.literal.hit',
          pass: literalMatches.length > 0,
          details: `matchCount=${literalMatches.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.search.regex.hit',
          pass: regexMatches.length > 0,
          details: `matchCount=${regexMatches.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.preview.html.ok',
          pass:
            asBoolean(asRecord(result.previewResult).ok) &&
            previewPath.includes(path.join('.ncurator', 'docx-previews')),
          details: previewPath
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.save.ok',
          pass: asBoolean(asRecord(result.saveResult).ok),
          details: asString(asRecord(result.saveResult).error)
        })
        recordAssertion(runtime.assertions, {
          id: 'docx.validate.ok',
          pass: asBoolean(asRecord(result.validateResult).ok),
          details: `problems=${validateProblems.length}`
        })

        const requiredTools = [
          'docx_open',
          'docx_outline',
          'docx_get_block',
          'docx_apply_ops',
          'docx_search',
          'docx_render_preview',
          'docx_save',
          'docx_validate'
        ]
        const seen = new Set(startedToolNames)
        const missingTools = requiredTools.filter((toolName) => !seen.has(toolName))
        recordAssertion(runtime.assertions, {
          id: 'docx.tools.full-chain-covered',
          pass: missingTools.length === 0,
          details: `missing=${missingTools.join(', ') || 'none'}`
        })

        const previewWarnings = asStringArray(asRecord(result.previewResult).warnings)
        recordAssertion(runtime.assertions, {
          id: 'docx.preview.no-warning',
          pass: previewWarnings.length === 0,
          details: previewWarnings.join('; ')
        })
      }
    })
  })
})

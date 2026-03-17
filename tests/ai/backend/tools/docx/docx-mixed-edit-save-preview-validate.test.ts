import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { DocxOutlineBlock, DocxValidationProblem } from '../../../../../src/main/services/ai/tools/docx/types'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createDocxToolHarness, writeWorkbenchSampleDocx } from '../../../../harness/backend/aiToolHarness'

type DocxOpenResult = {
  ok: boolean
  code: string
  summary: string
  docId: string
}

type DocxOutlineResult = {
  ok: boolean
  code: string
  summary: string
  blocks: DocxOutlineBlock[]
}

type DocxApplyOpsResult = {
  ok: boolean
  code: string
  summary: string
  newDocId: string
  changedBlocks: Array<{
    action: string
    blockId: string
    beforeText: string
    afterText: string
  }>
}

type DocxPreviewResult = {
  ok: boolean
  code: string
  summary: string
  format: 'html'
  previewPath: string
  renderer: string
}

type DocxValidateResult = {
  ok: boolean
  code: string
  summary: string
  problems: DocxValidationProblem[]
}

type DocxSaveResult = {
  ok: boolean
  code: string
  summary: string
  outPath: string
  operation: 'created' | 'updated'
  byteSize: number
}

type DocxSearchResult = {
  ok: boolean
  code: string
  summary: string
  matches: Array<{
    blockId: string
    text: string
    offsets: Array<{ start: number; end: number }>
  }>
}

describe('docx mixed edit save preview validate', () => {
  it('applies mixed operations, emits preview/save artifacts, and persists edits to disk', async () => {
    await runBackendCase({
      caseId: 'docx-mixed-edit-save-preview-validate',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['docx'],
      description: '验证 docx capability 能完成混合编辑、预览、校验与保存闭环',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docx-edit-flow.docx')
        const harness = createDocxToolHarness(runtime)

        try {
          const openResult = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, sourcePath)
          })
          if (!openResult.ok) {
            throw new Error(openResult.summary)
          }

          const outlineResult = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: openResult.docId,
            includeTables: true,
            includeCells: true
          })
          if (!outlineResult.ok) {
            throw new Error(outlineResult.summary)
          }

          const helloParagraph = outlineResult.blocks.find(
            (block) => block.type === 'paragraph' && block.text.includes('Hello team')
          )
          const ownerCell = outlineResult.blocks.find(
            (block) => block.type === 'table_cell' && block.text.includes('Alice')
          )

          if (!helloParagraph || !ownerCell) {
            throw new Error('failed to resolve editable paragraph or owner cell block')
          }

          const applyResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: openResult.docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hi',
                blockIds: [helloParagraph.blockId]
              },
              {
                type: 'update_table_cell',
                blockId: ownerCell.blockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [
                      {
                        text: 'Bob'
                      }
                    ]
                  }
                ]
              },
              {
                type: 'insert_after',
                anchorBlockId: helloParagraph.blockId,
                content: [
                  {
                    kind: 'paragraph',
                    runs: [
                      {
                        text: 'Conclusion: schedule is stable and risks are controlled.'
                      }
                    ]
                  }
                ]
              }
            ]
          })
          if (!applyResult.ok) {
            throw new Error(applyResult.summary)
          }

          const previewResult = await harness.invoke<DocxPreviewResult>('docx_render_preview', {
            docId: applyResult.newDocId,
            format: 'html'
          })
          if (!previewResult.ok) {
            throw new Error(previewResult.summary)
          }

          const validateResult = await harness.invoke<DocxValidateResult>('docx_validate', {
            docId: applyResult.newDocId
          })
          if (!validateResult.ok) {
            throw new Error(validateResult.summary)
          }

          const saveResult = await harness.invoke<DocxSaveResult>('docx_save', {
            docId: applyResult.newDocId,
            outPath: 'deliverables/final-report.docx'
          })
          if (!saveResult.ok) {
            throw new Error(saveResult.summary)
          }

          const reopened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, saveResult.outPath)
          })
          if (!reopened.ok) {
            throw new Error(reopened.summary)
          }

          const conclusionSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: reopened.docId,
            query: 'Conclusion:',
            mode: 'literal'
          })
          const helloSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: reopened.docId,
            query: 'Hello',
            mode: 'literal'
          })

          runtime.recordEvent({
            type: 'step',
            name: 'docx-mixed-edit-flow',
            status: 'ok',
            message: 'docx 文档已完成混合编辑、预览、校验、保存与回读验证',
            data: {
              changedCount: applyResult.changedBlocks.length,
              previewPath: previewResult.previewPath,
              savePath: saveResult.outPath,
              validateProblems: validateResult.problems.length
            }
          })

          return {
            applyResult,
            previewResult,
            validateResult,
            saveResult,
            conclusionSearch,
            helloSearch,
            activities: harness.activities,
            aiEvents: runtime.eventCollector.snapshot()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.applyResult.changedBlocks.length >= 2, {
          name: 'docx-apply-ops-change-count',
          message: 'docx_apply_ops 至少为替换文本和表格更新记录了变更',
          data: {
            changedCount: result.applyResult.changedBlocks.length
          }
        })
        runtime.assertThat(fs.existsSync(result.previewResult.previewPath), {
          name: 'docx-preview-file-exists',
          message: 'docx_render_preview 已落出 preview artifact',
          data: {
            previewPath: result.previewResult.previewPath
          }
        })
        runtime.assertThat(result.validateResult.problems.length === 0, {
          name: 'docx-validate-clean',
          message: 'docx_validate 未发现结构问题'
        })
        runtime.assertThat(
          fs.existsSync(result.saveResult.outPath) &&
            result.saveResult.operation === 'created' &&
            result.saveResult.byteSize > 0,
          {
            name: 'docx-save-created-file',
            message: 'docx_save 已创建输出文件',
            data: {
              outPath: result.saveResult.outPath,
              byteSize: result.saveResult.byteSize
            }
          }
        )
        runtime.assertThat(result.conclusionSearch.matches.length === 1, {
          name: 'docx-saved-doc-has-conclusion',
          message: '保存后的 docx 能检索到新增结论段'
        })
        runtime.assertThat(
          result.applyResult.changedBlocks.some((block) => block.afterText.includes('Bob')),
          {
            name: 'docx-apply-ops-includes-table-update',
            message: 'docx_apply_ops 已记录表格负责人更新为 Bob',
            data: {
              changedBlocks: result.applyResult.changedBlocks
            }
          }
        )
        runtime.assertThat(result.helloSearch.matches.length === 0, {
          name: 'docx-saved-doc-no-hello-left',
          message: '保存后的 docx 中旧文本 Hello 已被替换'
        })
        runtime.assertThat(
          result.activities.some(
            (activity) =>
              activity.actionType === 'docx_apply_ops' && activity.status === 'completed'
          ),
          {
            name: 'docx-apply-ops-activity-completed',
            message: 'docx_apply_ops 已记录 completed activity'
          }
        )

        const fileArtifacts = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'file_artifact'
        )
        runtime.assertThat(
          fileArtifacts.length >= 2 &&
            fileArtifacts.some(
              (event) => event.type === 'file_artifact' && event.artifactRole === 'preview'
            ) &&
            fileArtifacts.some(
              (event) => event.type === 'file_artifact' && event.artifactRole === 'committed'
            ),
          {
            name: 'docx-file-artifacts-emitted',
            message: 'preview 与 committed 两类 docx artifact 事件都已产出',
            data: {
              artifactCount: fileArtifacts.length
            }
          }
        )
      }
    })
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  childElements,
  descendantElements
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/dom'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-artifact-projection', async () => {
    await runBackendCase({
      caseId: 'docx-review-artifact-projection',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 review/working artifact 由当前工作稿投影生成，并使用自定义样式与稳定表格布局。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'review-projection.docx', [
          {
            type: 'paragraph',
            text: '反走样'
          },
          {
            type: 'paragraph',
            text: '达到反走样。'
          },
          {
            type: 'paragraph',
            text: '结尾段落。'
          }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-review-projection-session',
          inputText: '补写解释和表格'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'review-projection.docx'
          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.preview.includes('结尾段落')
            )?.blockId || ''
          const tableInsert = await harness.invoke<DocxMutationResult>('docx_table_edit', {
            sourcePath: 'review-projection.docx',
            action: 'insert_after',
            anchorBlockId,
            rows: [
              ['反走样', '过拟合'],
              ['平滑边缘，降低锯齿', '记住训练噪声，泛化变差']
            ]
          })
          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          if (!detail || !detail.review.draft_artifact_path || !detail.review.working_artifact_path) {
            throw new Error('expected generated review artifacts')
          }

          const reviewBuffer = await fs.readFile(detail.review.draft_artifact_path)
          const reviewBundle = await loadDocxBundle(reviewBuffer)
          const reviewXml = new XMLSerializer().serializeToString(reviewBundle.documentDom)
          const table = descendantElements(reviewBundle.documentDom.documentElement, 'tbl')[0]
          const workingExists = await fs
            .access(detail.review.working_artifact_path)
            .then(() => true)
            .catch(() => false)

          return {
            outline,
            tableInsert,
            reviewId: detail.review.id,
            reviewArtifactPath: detail.review.draft_artifact_path,
            workingArtifactPath: detail.review.working_artifact_path,
            reviewXml,
            reviewHasNativeRevisions:
              descendantElements(reviewBundle.documentDom.documentElement, 'ins').length > 0 ||
              descendantElements(reviewBundle.documentDom.documentElement, 'del').length > 0,
            tableHasGrid: table ? childElements(table, 'tblGrid').length > 0 : false,
            tableHasLayout:
              table ? descendantElements(table, 'tblLayout').length > 0 : false,
            tableHasCellWidth:
              table ? descendantElements(table, 'tcW').length > 0 : false,
            workingExists
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.tableInsert.changedBlocks.length === 1 &&
            result.workingExists &&
            result.reviewArtifactPath.length > 0 &&
            result.workingArtifactPath.length > 0,
          {
            name: 'review-run-emits-working-and-review-artifacts',
            message: 'docx review finalize 后应同时产出 working artifact 与 review artifact。',
            data: {
              reviewArtifactPath: result.reviewArtifactPath,
              workingArtifactPath: result.workingArtifactPath,
              changedBlocks: result.tableInsert.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.reviewHasNativeRevisions === false &&
            result.tableHasGrid &&
            result.tableHasLayout &&
            result.tableHasCellWidth,
          {
            name: 'review-artifact-uses-custom-markers-and-stable-table-layout',
            message:
              'review artifact 不应再依赖原生 Word 修订标记，且插入表格应带稳定的 grid/layout/width 结构。',
            data: {
              reviewHasNativeRevisions: result.reviewHasNativeRevisions,
              tableHasGrid: result.tableHasGrid,
              tableHasLayout: result.tableHasLayout,
              tableHasCellWidth: result.tableHasCellWidth,
              reviewXmlSnippet: result.reviewXml.slice(0, 1200)
            }
          }
        )
      }
    })
  })
})

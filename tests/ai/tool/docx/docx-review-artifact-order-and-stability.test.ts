import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-artifact-order-and-stability', async () => {
    await runBackendCase({
      caseId: 'docx-review-artifact-order-and-stability',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 review artifact 直接基于当前 session 投影时，新增块顺序稳定，未修改原句不会被伪增删。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'review-order.docx', [
          { type: 'paragraph', text: '反走样' },
          { type: 'paragraph', text: '达到反走样。' },
          { type: 'paragraph', text: '结尾段落。' }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-review-order-session',
          inputText: '追加解释和对照表'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'review-order.docx'
          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('达到反走样')
            )?.blockId || ''

          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'review-order.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId,
              blocks: [{ type: 'paragraph', text: '反走样可以理解为通过平滑高频锯齿来减少边缘突变。' }]
            }]
          })
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'review-order.docx',
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId,
              blocks: [{ type: 'table', rows: [
              ['反走样', '过拟合'],
              ['平滑边缘', '记住噪声']
            ] }]
            }]
          })

          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const review = details[0]?.review
          if (!review?.draft_artifact_path) {
            throw new Error('expected review artifact path')
          }

          const reviewBuffer = await fs.readFile(review.draft_artifact_path)
          const reviewBundle = await loadDocxBundle(reviewBuffer)
          const reviewOutline = buildBlockIndex(reviewBundle.documentDom).outline
            .filter((block) => block.type !== 'table_cell')
            .map((block) => ({
              type: block.type,
              text: block.type === 'table' ? block.text : block.text
            }))

          return {
            reviewOutline,
            unmodifiedSentenceCount: reviewOutline.filter((block) =>
              block.text.includes('达到反走样。')
            ).length
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.unmodifiedSentenceCount === 1,
          {
            name: 'review-artifact-does-not-duplicate-unmodified-tail-sentence',
            message: '未修改的原句不应在 review artifact 中被伪造成删一份再加一份。',
            data: {
              reviewOutline: result.reviewOutline
            }
          }
        )

        runtime.assertThat(
          result.reviewOutline[0]?.text.includes('反走样') &&
            result.reviewOutline[1]?.text.includes('达到反走样。') &&
            result.reviewOutline[2]?.text.includes('反走样可以理解为') &&
            result.reviewOutline[3]?.type === 'table' &&
            result.reviewOutline[4]?.text.includes('结尾段落。'),
          {
            name: 'review-artifact-keeps-inserted-block-order-stable',
            message: 'review artifact 应按当前 working 结构顺序投影新增段落与表格，不得拆散位置。',
            data: {
              reviewOutline: result.reviewOutline
            }
          }
        )
      }
    })
  })
})

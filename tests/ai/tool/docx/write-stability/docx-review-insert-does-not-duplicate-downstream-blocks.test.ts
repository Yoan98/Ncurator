import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from '../testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-insert-does-not-duplicate-downstream-blocks', async () => {
    await runBackendCase({
      caseId: 'docx-review-insert-does-not-duplicate-downstream-blocks',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx', 'write-stability'],
      description: '验证 review artifact 中插入后下游旧块不重复、不乱序。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'review-insert-no-duplicate.docx', [
          { type: 'paragraph', text: '概念引导。' },
          { type: 'paragraph', text: '学生端脚手架引导：' },
          { type: 'paragraph', text: '完成引导后进入正式任务。' }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-review-insert-does-not-duplicate-downstream-blocks-session',
          inputText: '在引导前加入说明和对照表'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'review-insert-no-duplicate.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 29 }],

          })
          const anchorBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('概念引导。')
            )?.blockId || ''
          const insertedParagraph = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: 'review-insert-no-duplicate.docx',
            action: 'insert_after',
            anchorBlockId,
            paragraphs: ['先用按钮提示解释本轮脚手架目标。']
          })
          const insertedParagraphBlockId = insertedParagraph.createdBlocks?.[0]?.blockId || ''
          await harness.invoke<DocxMutationResult>('docx_table_edit', {
            sourcePath: insertedParagraph.sourcePath,
            action: 'insert_after',
            anchorBlockId: insertedParagraphBlockId,
            rows: [
              ['提示', '动作'],
              ['开始', '进入脚手架']
            ]
          })

          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const reviewPath = details[0]?.review.draft_artifact_path
          if (!reviewPath) {
            throw new Error('expected review artifact path')
          }

          const reviewBundle = await loadDocxBundle(await fs.readFile(reviewPath))
          const reviewOutline = buildBlockIndex(reviewBundle.documentDom).outline
            .filter((block) => block.type !== 'table_cell')
            .map((block) => ({
              type: block.type,
              text: block.type === 'table' ? block.text : block.text
            }))

          return {
            reviewOutline,
            scaffoldCount: reviewOutline.filter((block) => block.text.includes('学生端脚手架引导：'))
              .length
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.scaffoldCount === 1 &&
            result.reviewOutline[0]?.text.includes('概念引导。') &&
            result.reviewOutline[1]?.text.includes('先用按钮提示解释本轮脚手架目标。') &&
            result.reviewOutline[2]?.type === 'table' &&
            result.reviewOutline[3]?.text.includes('学生端脚手架引导：') &&
            result.reviewOutline[4]?.text.includes('完成引导后进入正式任务。'),
          {
            name: 'review-insert-keeps-downstream-blocks-stable',
            message: 'review artifact 中插入后的顺序应稳定，下游旧段落不得重复或错位。',
            data: {
              reviewOutline: result.reviewOutline
            }
          }
        )
      }
    })
  })
})

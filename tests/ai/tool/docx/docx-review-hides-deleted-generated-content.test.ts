import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-hides-deleted-generated-content', async () => {
    await runBackendCase({
      caseId: 'docx-review-hides-deleted-generated-content',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 generated 内容中途新增后又删除时，不会在最终 review 中以红删展示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'review-hide-generated-delete.docx', [
          { type: 'paragraph', text: 'Anchor paragraph.' },
          { type: 'paragraph', text: 'Stable tail.' }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-review-hides-deleted-generated-content-session',
          inputText: '插入后再删除中间废稿'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'review-hide-generated-delete.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          })
          const anchorBlockId =
            outline.blocks.find((block) => block.type === 'paragraph' && block.text.includes('Anchor paragraph.'))?.blockId || ''
          const inserted = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: 'review-hide-generated-delete.docx',
            action: 'insert_after',
            anchorBlockId,
            paragraphs: ['Temporary generated draft.']
          })
          const insertedBlockId = inserted.createdBlocks?.[0]?.blockId || ''
          await harness.invoke<DocxMutationResult>('docx_delete', {
            sourcePath: 'review-hide-generated-delete.docx',
            blockIds: [insertedBlockId]
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
          const reviewXml = new XMLSerializer().serializeToString(reviewBundle.documentDom)
          return {
            reviewXml
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.reviewXml.includes('Temporary generated draft.'),
          {
            name: 'review-hides-generated-delete-markup',
            message: 'AI 自己新增又删除的废稿不应再进入用户 review artifact。',
            data: {
              reviewXmlSnippet: result.reviewXml.slice(0, 1500)
            }
          }
        )
      }
    })
  })
})

import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxCreateResult, DocxMutationResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-create-target-review-shows-net-additions-only', async () => {
    await runBackendCase({
      caseId: 'docx-create-target-review-shows-net-additions-only',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 create-target 场景多轮草稿往返后，review 只展示最终存活新增内容。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxReviewRun()
          await harness.invoke<DocxCreateResult>('docx_create', {
            sourcePath: 'net-additions-only.docx',
            blocks: [
              { type: 'heading', level: 1, text: 'Final Report' },
              { type: 'paragraph', text: 'Keep this final paragraph.' }
            ]
          })

          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'net-additions-only.docx'
          })
          const finalParagraphBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.preview.includes('Keep this final paragraph.')
            )?.blockId || ''

          const inserted = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: 'net-additions-only.docx',
            action: 'insert_after',
            anchorBlockId: finalParagraphBlockId,
            text: 'Temporary draft that should disappear from review.'
          })
          const temporaryBlockId = inserted.createdBlocks?.[0]?.blockId || ''

          await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: 'net-additions-only.docx',
            action: 'delete',
            blockId: temporaryBlockId
          })

          const details = await harness.ctx.finalizeDocxReviewRun()
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
          result.reviewXml.includes('Final Report') &&
            result.reviewXml.includes('Keep this final paragraph.') &&
            !result.reviewXml.includes('Temporary draft that should disappear from review.'),
          {
            name: 'create-target-review-only-shows-final-net-additions',
            message: 'create-target review 应只保留最终存活新增内容，不展示 AI 中途删掉的废稿。',
            data: {
              reviewXmlSnippet: result.reviewXml.slice(0, 1800)
            }
          }
        )
      }
    })
  })
})

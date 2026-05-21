import fs from 'node:fs/promises'
import { XMLSerializer } from '@xmldom/xmldom'
import { describe, it } from 'vitest'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  createDocxToolHarness,
  writeRichTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-style-text-review-highlight', async () => {
    await runBackendCase({
      caseId: 'docx-style-text-review-highlight',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 style_text 会在 review artifact 中以独立浅青色高亮显示，并且 committed artifact 不保留该高亮。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeRichTestDocxFile(runtime.workspaceRoot, 'style-highlight.docx', [
          {
            type: 'paragraph',
            paragraph: {
              runs: [{ text: '负责人：Alice 将在周五完成复核。' }]
            }
          }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-style-highlight-session',
          inputText: '把 Alice 标成重点'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'style-highlight.docx'
          })
          const paragraphBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('Alice')
            )?.blockId || ''
          const styled = await harness.invoke<DocxMutationResult>('docx_text_style_edit', {
            sourcePath: 'style-highlight.docx',
            blockId: paragraphBlockId,
            query: 'Alice',
            style: {
              bold: true,
              color: '2563EB'
            }
          })
          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          if (
            !detail ||
            !detail.review.draft_artifact_path ||
            !detail.review.committed_artifact_path
          ) {
            throw new Error('expected generated review and committed artifacts')
          }

          const reviewBuffer = await fs.readFile(detail.review.draft_artifact_path)
          const committedBuffer = await fs.readFile(detail.review.committed_artifact_path)
          const reviewBundle = await loadDocxBundle(reviewBuffer)
          const committedBundle = await loadDocxBundle(committedBuffer)

          return {
            styled,
            reviewPath: detail.review.draft_artifact_path,
            committedPath: detail.review.committed_artifact_path,
            reviewXml: new XMLSerializer().serializeToString(reviewBundle.documentDom),
            committedXml: new XMLSerializer().serializeToString(committedBundle.documentDom),
            changeTitles: detail.changes.map((change) => change.title),
            changeSummaries: detail.changes.map((change) => change.summary)
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.styled.changedBlocks.some((block) => block.action === 'style_text') &&
            result.changeTitles.includes('更新文本样式: Alice') &&
            result.changeSummaries.some((summary) => summary.includes('更新文本样式') && summary.includes('Alice')),
          {
            name: 'style-text-review-summary-uses-style-specific-copy',
            message: 'style_text 进入 review 记录后，应使用独立的样式修改标题和摘要。',
            data: {
              changedBlocks: result.styled.changedBlocks,
              changeTitles: result.changeTitles,
              changeSummaries: result.changeSummaries
            }
          }
        )

        runtime.assertThat(
          result.reviewXml.includes('CFFAFE') && !result.committedXml.includes('CFFAFE'),
          {
            name: 'style-text-review-highlight-stays-review-only',
            message: 'style_text 应只在 review artifact 中带浅青色高亮，committed artifact 不应保留该显示层标记。',
            data: {
              reviewPath: result.reviewPath,
              committedPath: result.committedPath,
              reviewHasHighlight: result.reviewXml.includes('CFFAFE'),
              committedHasHighlight: result.committedXml.includes('CFFAFE'),
              reviewXmlSnippet: result.reviewXml.slice(0, 1200),
              committedXmlSnippet: result.committedXml.slice(0, 1200)
            }
          }
        )
      }
    })
  })
})

import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from '../testUtils'

describe('ai tool docx backend', () => {
  it('docx-created-blocks-resolve-inserted-range-not-shifted-tail', async () => {
    await runBackendCase({
      caseId: 'docx-created-blocks-resolve-inserted-range-not-shifted-tail',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx', 'write-stability'],
      description: '验证 createdBlocks 基于插入区间解析，只命中新插入块，不误认下游旧块。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'created-blocks-insert-range.docx', [
          { type: 'paragraph', text: 'Anchor paragraph.' },
          { type: 'paragraph', text: 'Tail paragraph should stay old.' },
          { type: 'paragraph', text: 'Last paragraph.' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outlineBefore = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'created-blocks-insert-range.docx',
            maxBlocks: 20
          })
          const anchorBlockId =
            outlineBefore.blocks.find(
              (block) => block.type === 'paragraph' && block.preview.includes('Anchor paragraph.')
            )?.blockId || ''

          const inserted = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: 'created-blocks-insert-range.docx',
            action: 'insert_after',
            anchorBlockId,
            text: 'Inserted paragraph.'
          })
          const outlineAfter = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: inserted.sourcePath,
            maxBlocks: 20
          })
          const createdPreviews = (inserted.createdBlocks || []).map((created) => ({
            ...created,
            preview:
              outlineAfter.blocks.find((block) => block.blockId === created.blockId)?.preview || ''
          }))

          return {
            inserted,
            outlineAfter,
            createdPreviews
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.inserted.createdBlocks?.length === 1 &&
            result.inserted.createdBlocks[0]?.type === 'paragraph' &&
            result.createdPreviews[0]?.preview.includes('Inserted paragraph.') &&
            !result.createdPreviews.some((block) =>
              block.preview.includes('Tail paragraph should stay old.')
            ),
          {
            name: 'created-blocks-only-track-true-inserted-paragraph',
            message: 'createdBlocks 必须只指向真实插入段落，不能把下游旧段落误当成新增块。',
            data: {
              createdBlocks: result.inserted.createdBlocks,
              createdPreviews: result.createdPreviews,
              outlineAfter: result.outlineAfter.blocks
            }
          }
        )
      }
    })
  })
})

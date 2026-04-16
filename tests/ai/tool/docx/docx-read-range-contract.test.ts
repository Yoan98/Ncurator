import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult, DocxReadResult } from './testUtils'
import { findParagraphBlockIdByText } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-read-range-contract', async () => {
    await runBackendCase({
      caseId: 'docx-read-range-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_read(fromBlockId,toBlockId) 会返回稳定的连续 blocks 区间。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'range-read.docx', [
          { type: 'paragraph', text: '第一段。' },
          { type: 'paragraph', text: '第二段。' },
          { type: 'paragraph', text: '第三段。' },
          { type: 'paragraph', text: '第四段。' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'range-read.docx',
            maxBlocks: 20
          })
          const fromBlockId = findParagraphBlockIdByText(outline.blocks, '第二段。')
          const toBlockId = findParagraphBlockIdByText(outline.blocks, '第四段。')
          const read = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: 'range-read.docx',
            fromBlockId,
            toBlockId
          })
          return {
            outline,
            read
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.read.returnedBlockCount === 3 &&
            result.read.blocks.map((block) => block.bodyIndex).join(',') === '1,2,3' &&
            result.read.blocks.every((block) => block.type === 'paragraph'),
          {
            name: 'range-read-returns-contiguous-blocks-in-order',
            message: '区间精读应按文档顺序返回连续 blocks。',
            data: result.read
          }
        )
      }
    })
  })
})

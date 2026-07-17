import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-outline-pagination-contract', async () => {
    await runBackendCase({
      caseId: 'docx-outline-pagination-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_read_outline 的 block_index 范围可以翻到长文档后半段。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'outline-pagination.docx',
          Array.from({ length: 90 }, (_, index) => ({
            type: 'paragraph' as const,
            text: `第 ${String(index + 1)} 段。`
          }))
        )

        const harness = createDocxToolHarness(runtime)
        try {
          return await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'outline-pagination.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 70, toBlockIndex: 79 }]
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.blocks.length === 10 &&
            result.blocks[0]?.blockIndex === 70 &&
            result.blocks[9]?.blockIndex === 79,
          {
            name: 'outline-pagination-can-browse-late-document-sections',
            message: 'outline 应支持从指定 blockIndex 范围浏览长文档。',
            data: result
          }
        )
      }
    })
  })
})

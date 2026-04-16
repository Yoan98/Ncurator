import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-outline-pagination-contract', async () => {
    await runBackendCase({
      caseId: 'docx-outline-pagination-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_outline(fromBodyIndex,maxBlocks) 可以翻到长文档后半段。',
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
          return await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'outline-pagination.docx',
            fromBodyIndex: 70,
            maxBlocks: 10
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.totalBlockCount === 90 &&
            result.returnedBlockCount === 10 &&
            result.truncated &&
            result.blocks[0]?.bodyIndex === 70 &&
            result.blocks[9]?.bodyIndex === 79,
          {
            name: 'outline-pagination-can-browse-late-document-sections',
            message: 'outline 应支持从指定 bodyIndex 开始分页浏览长文档。',
            data: result
          }
        )
      }
    })
  })
})

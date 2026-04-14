import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOpenResult, DocxOutlineResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-scope-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-scope-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_search 默认搜索全文，scope.blockIds 只在当前文档内缩圈。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'scope-contract.docx', [
          {
            type: 'paragraph',
            text: '目标术语出现在第一段。'
          },
          {
            type: 'paragraph',
            text: '中间干扰段落。'
          },
          {
            type: 'paragraph',
            text: '目标术语也出现在第三段。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'scope-contract.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: opened.sourcePath,
            maxBlocks: 20
          })
          const firstScopedBlockId =
            outline.blocks.find((block) => block.text.includes('第一段'))?.blockId || ''
          const fullSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: opened.sourcePath,
            query: '目标术语',
            mode: 'literal'
          })
          const scopedSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: opened.sourcePath,
            query: '目标术语',
            mode: 'literal',
            scope: {
              blockIds: [firstScopedBlockId]
            }
          })

          return {
            firstScopedBlockId,
            fullSearch,
            scopedSearch
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.fullSearch.matches.length === 2 &&
            result.scopedSearch.matches.length === 1 &&
            result.scopedSearch.matches[0]?.blockId === result.firstScopedBlockId,
          {
            name: 'docx-search-scope-stays-explicit',
            message: '默认搜索应覆盖全文，scope.blockIds 只返回指定 block 范围内的结果。',
            data: result
          }
        )
      }
    })
  })
})

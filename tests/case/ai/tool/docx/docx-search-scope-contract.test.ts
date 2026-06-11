import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-scope-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-scope-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_search 默认搜索全文，docx_edit(replace_text).blockIds 只在当前文档内缩圈。',
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
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'scope-contract.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          })
          const firstScopedBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('第一段')
            )?.blockId || ''
          const fullRead = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: outline.sourcePath,
            query: '目标术语'
          })
          const scopedEdit = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [{
              type: 'replace_text',
              query: '目标术语',
              replace: '限定术语',
              blockIds: [firstScopedBlockId]
            }]
          })
          const scopedRead = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: scopedEdit.sourcePath,
            query: '限定术语'
          })
          const remainingRead = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: scopedEdit.sourcePath,
            query: '目标术语'
          })

          return {
            firstScopedBlockId,
            fullRead,
            scopedEdit,
            scopedRead,
            remainingRead
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.fullRead.matches.length === 2 &&
            result.scopedRead.matches.length === 1 &&
            result.scopedRead.matches[0]?.blockId === result.firstScopedBlockId &&
            result.remainingRead.matches.length === 1,
          {
            name: 'docx-search-scope-stays-explicit',
            message: '默认搜索应覆盖全文，docx_edit(replace_text).blockIds 只修改指定 block 范围内的结果。',
            data: result
          }
        )
      }
    })
  })
})

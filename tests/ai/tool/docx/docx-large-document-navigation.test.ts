import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxGetBlockResult,
  type DocxOpenResult,
  type DocxOutlineResult,
  type DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-large-document-navigation', async () => {
    await runBackendCase({
      caseId: 'docx-large-document-navigation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证长文档下 open/outline/search/get_block 的定位链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'large-navigation.docx',
          Array.from({ length: 80 }, (_, index) => ({
            type: 'paragraph' as const,
            text:
              index === 72
                ? `Section ${String(index + 1).padStart(2, '0')}: target keyword appears here.`
                : `Section ${String(index + 1).padStart(2, '0')}: regular filler paragraph.`
          }))
        )

        const harness = createDocxToolHarness(runtime)
        try {
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'large-navigation.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: opened.docId,
            maxBlocks: 20
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: opened.docId,
            query: 'target keyword',
            mode: 'literal'
          })
          const block = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: opened.docId,
            blockId: search.matches[0]?.blockId || ''
          })

          return {
            opened,
            outline,
            search,
            block
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.opened.stats.blockCount >= 80 &&
            result.outline.blocks.length === 20 &&
            result.outline.truncated,
          {
            name: 'large-document-outline-stays-stable-under-truncation',
            message: '长文档 outline 应返回稳定 block 信息，并正确标记 maxBlocks 截断。',
            data: {
              stats: result.opened.stats,
              outlineCount: result.outline.blocks.length,
              truncated: result.outline.truncated
            }
          }
        )

        runtime.assertThat(
          result.search.matches.length === 1 &&
            result.block.block.type === 'paragraph' &&
            result.block.block.text.includes('target keyword appears here'),
          {
            name: 'large-document-search-can-locate-and-read-target-block',
            message: 'search 与 get_block 应能在长文档中稳定定位并精读目标 block。',
            data: {
              matches: result.search.matches,
              block: result.block.block
            }
          }
        )
      }
    })
  })
})

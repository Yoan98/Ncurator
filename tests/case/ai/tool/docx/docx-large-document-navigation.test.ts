import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  type DocxOutlineResult,
  type DocxReadResult,
  type DocxSearchResult,
  readDocxNodeText
} from './testUtils'
import { findParagraphBlockIndexByText } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-large-document-navigation', async () => {
    await runBackendCase({
      caseId: 'docx-large-document-navigation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证长文档下 outline/read 的定位链路。',
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
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'large-navigation.docx'),
            ranges: [{ type: 'block_index', fromBlockIndex: 70, toBlockIndex: 79 }]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'large-navigation.docx'),
            query: 'target keyword'
          })
          const read = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: path.join(runtime.workspaceRoot, 'large-navigation.docx'),
            range: { type: 'block_ids', blockIds: [search.matches[0]!.blockId] }
          })

          return {
            outline,
            search,
            read
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.blocks.length === 10 &&
            (result.outline.blocks[0]?.blockIndex || 0) >= 70 &&
            result.outline.blocks[9]?.blockIndex === 79 &&
            findParagraphBlockIndexByText(result.outline.blocks, 'target keyword appears here.') ===
              72,
          {
            name: 'large-document-outline-stays-stable-under-truncation',
            message: '长文档 outline 应返回稳定 block 信息，并正确标记范围结果。',
            data: result.outline
          }
        )

        runtime.assertThat(
          result.search.matches.length === 1 &&
            result.read.blocks.length === 1 &&
            result.read.blocks[0]?.type === 'paragraph' &&
            readDocxNodeText(result.read.blocks[0]).includes('target keyword appears here'),
          {
            name: 'large-document-search-can-locate-and-read-target-block',
            message: 'docx_search + docx_read_blocks 应能在长文档中稳定定位并精读目标 block。',
            data: {
              searchMatches: result.search.matches,
              readBlocks: result.read.blocks
            }
          }
        )
      }
    })
  })
})

import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-working-draft-hides-deleted-content', async () => {
    await runBackendCase({
      caseId: 'docx-working-draft-hides-deleted-content',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证删除后的内容不会再出现在 AI 继续读取的 working draft 中，未修改内容保持可读。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'working-draft-delete.docx', [
          { type: 'paragraph', text: '第一段保留。' },
          { type: 'paragraph', text: '这段需要删除。' },
          { type: 'paragraph', text: '第三段也保留。' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'working-draft-delete.docx'),
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 19 }]
          })
          const deleteBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('这段需要删除')
            )?.blockId || ''

          const deleted = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: path.join(runtime.workspaceRoot, 'working-draft-delete.docx'),
            actions: [
              {
                type: 'delete_blocks',
                blockIds: [deleteBlockId]
              }
            ]
          })
          const deletedSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: deleted.sourcePath,
            query: '这段需要删除。'
          })
          const keptFirstSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: deleted.sourcePath,
            query: '第一段保留。'
          })
          const keptThirdSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: deleted.sourcePath,
            query: '第三段也保留。'
          })

          return {
            deleted,
            deletedSearch,
            keptFirstSearch,
            keptThirdSearch
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.deleted.changedBlocks.length === 1, {
          name: 'delete-op-applies-cleanly',
          message: '删除段落后应产生一次稳定变更，且不应附带额外警告。',
          data: result.deleted
        })

        runtime.assertThat(
          result.deletedSearch.matches.length === 0 &&
            result.keptFirstSearch.matches.length === 1 &&
            result.keptThirdSearch.matches.length === 1,
          {
            name: 'working-draft-hides-deleted-but-keeps-neighbors',
            message:
              'working draft 应隐藏 deleted 内容，但未修改的相邻段落仍应继续可读，不得丢失原文其他信息。',
            data: {
              deletedSearch: result.deletedSearch.matches,
              keptFirstSearch: result.keptFirstSearch.matches,
              keptThirdSearch: result.keptThirdSearch.matches
            }
          }
        )
      }
    })
  })
})

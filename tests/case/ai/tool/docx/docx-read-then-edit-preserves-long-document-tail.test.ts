import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type {
  DocxMutationResult,
  DocxOutlineResult,
  DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-read-then-edit-preserves-long-document-tail', async () => {
    await runBackendCase({
      caseId: 'docx-read-then-edit-preserves-long-document-tail',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证长文档在 read 分页后升级到 replay session 时不会丢失尾部 block。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'long-tail-upgrade.docx',
          Array.from({ length: 5105 }, (_, index) => ({
            type: 'paragraph' as const,
            text: `第 ${String(index + 1)} 段。`
          }))
        )
        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'long-tail-upgrade.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 5098, toBlockIndex: 5107 }]
          })
          const tailBlockId = outline.blocks[outline.blocks.length - 1]?.blockId || ''
          const mutation = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'long-tail-upgrade.docx',
            actions: [{
              type: 'replace_text',
              query: '第 5105 段。',
              replace: '尾部段落已经改写。',
              blockIds: [tailBlockId]
            }]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'long-tail-upgrade.docx',
            query: '尾部段落已经改写。',
            mode: 'literal'
          })
          return {
            outline,
            mutation,
            search,
            readSessionCount: harness.state.readSessionBySourcePath.size,
            replaySessionCount: harness.state.replaySessionBySourcePath.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.currentRevisionRef === 'v1' &&
            result.outline.blocks.length >= 7 &&
            result.outline.blocks[0]?.blockIndex === 5098 &&
            result.outline.blocks[result.outline.blocks.length - 1]?.blockIndex === 5104 &&
            result.mutation.currentRevisionRef === 'v2' &&
            result.search.currentRevisionRef === 'v2' &&
            result.search.returnedMatchCount >= 1 &&
            result.readSessionCount === 0 &&
            result.replaySessionCount === 1,
          {
            name: 'docx-replay-upgrade-preserves-long-document-tail',
            message: '长文档在 read 分页后升级到 replay session 时，尾部 block 仍应可编辑并可被后续搜索命中。',
            data: result
          }
        )
      }
    })
  })
})

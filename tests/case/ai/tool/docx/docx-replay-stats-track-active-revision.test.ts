import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'
import { findParagraphBlockIdByText } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-replay-stats-track-active-revision', async () => {
    await runBackendCase({
      caseId: 'docx-replay-stats-track-active-revision',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 replay session 的 stats 会随 active revision 前进而同步刷新。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'replay-stats-active-revision.docx', [
          { type: 'paragraph', text: '开头段落' },
          { type: 'paragraph', text: '锚点段落' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const initialOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'replay-stats-active-revision.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })
          const anchorBlockId = findParagraphBlockIdByText(initialOutline.blocks, '锚点段落')

          const insertResult = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'replay-stats-active-revision.docx',
            actions: [
              {
                type: 'insert_blocks',
                anchorBlockId,
                position: 'after',
                blocks: [docxParagraphNode('新增段落')]
              }
            ]
          })
          const statsAfterInsert = harness.state.replaySessionBySourcePath.get(
            insertResult.sourcePath
          )?.stats

          const rewriteResult = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'replay-stats-active-revision.docx',
            actions: [
              {
                type: 'replace_text',
                query: '新增段落',
                replace: '新增段落二稿'
              }
            ]
          })
          const statsAfterRewrite = harness.state.replaySessionBySourcePath.get(
            rewriteResult.sourcePath
          )?.stats

          const finalOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'replay-stats-active-revision.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })

          return {
            insertResult,
            rewriteResult,
            statsAfterInsert,
            statsAfterRewrite,
            finalOutline
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.statsAfterInsert?.blockCount === 3 &&
            result.statsAfterRewrite?.blockCount === 3 &&
            result.finalOutline.blocks.length === 3 &&
            result.finalOutline.blocks.some(
              (block) => block.type === 'paragraph' && block.text === '新增段落二稿'
            ),
          {
            name: 'replay-stats-track-active-revision',
            message:
              '每次 registerRevision 后，replay stats 都应与当前 active snapshot 对齐，而不是残留旧 revision 的 blockCount。',
            data: {
              insertResult: result.insertResult,
              rewriteResult: result.rewriteResult,
              statsAfterInsert: result.statsAfterInsert,
              statsAfterRewrite: result.statsAfterRewrite,
              finalOutline: result.finalOutline.blocks
            }
          }
        )
      }
    })
  })
})

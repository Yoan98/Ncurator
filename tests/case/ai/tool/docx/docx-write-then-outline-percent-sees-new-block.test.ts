import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxHeadingNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult } from './testUtils'
import { findParagraphBlockIdByText } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-write-then-outline-percent-sees-new-block', async () => {
    await runBackendCase({
      caseId: 'docx-write-then-outline-percent-sees-new-block',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx 写后立刻用 percent 读取 outline 时，能看到当前 revision 新增块。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'outline-percent-after-write.docx', [
          { type: 'heading', text: '复习总结', level: 1 },
          { type: 'paragraph', text: '导语段落。' }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const beforeOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'outline-percent-after-write.docx'),
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          })
          const anchorBlockId = findParagraphBlockIdByText(beforeOutline.blocks, '导语段落')

          const writeResult = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: path.join(runtime.workspaceRoot, 'outline-percent-after-write.docx'),
            actions: [
              {
                type: 'insert_blocks',
                location: { blockId: anchorBlockId, position: 'after' },

                blocks: [docxHeadingNode(2, '第一部分：深度学习')]
              }
            ]
          })

          const afterOutline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'outline-percent-after-write.docx'),
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          })

          return {
            beforeOutline,
            writeResult,
            afterOutline,
            replayStats: harness.state.replaySessionBySourcePath.get(writeResult.sourcePath)?.stats
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const createdParagraphId = result.writeResult.createdBlocks?.find(
          (block) => block.type === 'paragraph'
        )?.blockId
        runtime.assertThat(
          result.beforeOutline.blocks.length === 2 &&
            /^blk_[0-9a-f]{32}$/.test(createdParagraphId || '') &&
            result.afterOutline.blocks.some(
              (block) =>
                block.type === 'paragraph' &&
                block.blockId === createdParagraphId &&
                block.text === '第一部分：深度学习'
            ) &&
            result.replayStats?.blockCount === 3,
          {
            name: 'outline-percent-sees-new-block-after-write',
            message:
              '写后同 revision 的 percent outline 应立刻包含新增块，且 replay stats.blockCount 必须同步到当前真实块数。',
            data: {
              beforeOutline: result.beforeOutline.blocks,
              writeResult: result.writeResult,
              afterOutline: result.afterOutline.blocks,
              replayStats: result.replayStats
            }
          }
        )
      }
    })
  })
})

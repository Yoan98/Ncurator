import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type {
  DocxCreateResult,
  DocxMutationResult,
  DocxOutlineResult,
  DocxReadResult,
  DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-create-then-open-and-edit', async () => {
    await runBackendCase({
      caseId: 'docx-create-then-open-and-edit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证新创建的 docx 可以马上被读取，并继续进入后续编辑链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          const sourcePath = 'generated-summary.docx'
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath,
            actions: [{
              type: 'create_document',
              blocks: [
                {
                  type: 'heading',
                  level: 1,
                  text: '深度学习与图形学复习总结'
                },
                {
                  type: 'paragraph',
                  text: '过拟合：待补充。'
                }
              ]
            }]
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })
          const paragraphBlockId =
            outline.blocks.find(
              (block) => block.type === 'paragraph' && block.text.includes('过拟合：待补充')
            )?.blockId || ''
          const read = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath,
            range: { type: 'block_ids', blockIds: [paragraphBlockId] }
          })
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [{
              type: 'replace_text',
              query: '过拟合：待补充。',
              replace: '过拟合：训练时间过久时容易出现，课件没有写具体处理方法。'
            }]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: '训练时间过久'
          })
          const targetPath = `${runtime.workspaceRoot}/${sourcePath}`
          const targetExists = await fs
            .access(targetPath)
            .then(() => true)
            .catch(() => false)

          return {
            created,
            outline,
            read,
            edited,
            search,
            targetExists
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.created.previousRevisionRef === 'v1' &&
            result.created.currentRevisionRef === 'v2' &&
            result.created.createdBlocks.length >= 2 &&
            Array.isArray(result.created.postWriteReadback.regions) &&
            result.outline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('过拟合：待补充')
            ) &&
            result.read.blocks.length === 1,
          {
            name: 'docx-create-produces-readable-initial-document',
            message: 'docx_edit(create_document) 后应立刻生成可 outline / read 的合法 docx 文档。',
            data: {
              created: result.created,
              outline: result.outline.blocks,
              read: result.read.blocks
            }
          }
        )

        runtime.assertThat(
          result.edited.previousRevisionRef === result.created.currentRevisionRef &&
            result.edited.changedBlocks.length === 1 &&
            result.search.matches.length === 1 &&
            result.targetExists === false,
          {
            name: 'docx-create-can-flow-into-followup-edit',
            message: 'create-target docx 应可直接进入后续编辑链路，并且在 apply 前不提前落正式目标文件。',
            data: {
              edited: result.edited,
              search: result.search.matches,
              targetExists: result.targetExists
            }
          }
        )
      }
    })
  })
})

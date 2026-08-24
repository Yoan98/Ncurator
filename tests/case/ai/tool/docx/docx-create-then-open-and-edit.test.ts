import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxHeadingNode,
  docxParagraphNode
} from '../../../../harness/backend/aiToolHarness'
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
          const sourcePath = path.join(runtime.workspaceRoot, 'generated-summary.docx')
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'insert_blocks',

                blocks: [
                  docxHeadingNode(1, '深度学习与图形学复习总结'),
                  docxParagraphNode('过拟合：待补充。')
                ]
              }
            ]
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
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
            actions: [
              {
                type: 'replace_text',
                query: '过拟合：待补充。',
                replace: '过拟合：训练时间过久时容易出现，课件没有写具体处理方法。'
              }
            ]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: '训练时间过久'
          })
          const targetExists = await fs
            .access(sourcePath)
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
          result.created.createdBlocks.length >= 2 &&
            Array.isArray(result.created.createdBlockIds) &&
            result.outline.blocks.some(
              (block) => block.type === 'paragraph' && block.text.includes('过拟合：待补充')
            ) &&
            result.read.blocks.length === 1,
          {
            name: 'docx-create-produces-readable-initial-document',
            message: 'docx_edit(insert_blocks) 后应立刻生成可 outline / read 的合法 docx 文档。',
            data: {
              created: result.created,
              outline: result.outline.blocks,
              read: result.read.blocks
            }
          }
        )

        runtime.assertThat(
          result.edited.changedBlocks.length === 1 &&
            result.search.matches.length === 1 &&
            result.targetExists === true,
          {
            name: 'docx-create-can-flow-into-followup-edit',
            message: 'create-target docx 应立即落盘，并可直接进入后续编辑链路。',
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

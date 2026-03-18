import type { DocxOutlineBlock } from '../../../../../../src/main/services/ai/tools/docx/types'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../../harness/backend/aiToolHarness'
import {
  defineAiToolCase,
  findCellBlockContaining,
  findParagraphBlockContaining
} from '../../helpers'

defineAiToolCase({
  caseId: 'tool-docx-mixed-structural-edit',
  caseType: 'scenario',
  groups: ['docx', 'scenario'],
  description: '同一轮中完成 replace/insert/delete/update_table_cell 的结构化改写。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/mixed-edit.docx', [
      { type: 'heading', text: 'Weekly Brief', level: 1 },
      { type: 'paragraph', text: 'Status: old summary pending review.' },
      { type: 'paragraph', text: 'Remove this stale note.' },
      {
        type: 'table',
        rows: [
          ['Topic', 'Owner'],
          ['Risk', 'Alice']
        ]
      }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/mixed-edit.docx'
      })
      const outline = await harness.invoke<{ ok: boolean; blocks: DocxOutlineBlock[] }>(
        'docx_outline',
        {
          docId: open.docId,
          includeTables: true,
          includeCells: true
        }
      )
      const statusBlock = findParagraphBlockContaining(outline.blocks, 'Status: old summary pending review.')
      const staleBlock = findParagraphBlockContaining(outline.blocks, 'Remove this stale note.')
      const ownerCell = findCellBlockContaining(outline.blocks, 'Alice')
      const apply = await harness.invoke<{
        ok: boolean
        newDocId: string
        changedBlocks: Array<{ blockId: string; afterText: string }>
      }>('docx_apply_ops', {
        docId: open.docId,
        ops: [
          {
            type: 'replace_block',
            blockId: statusBlock?.blockId || 'missing-status',
            content: {
              kind: 'paragraph',
              runs: [{ text: 'Status: summary refreshed and ready for review.' }]
            }
          },
          {
            type: 'insert_after',
            anchorBlockId: staleBlock?.blockId || 'missing-stale',
            content: [
              {
                kind: 'paragraph',
                runs: [{ text: 'New milestone added: complete design review.' }]
              }
            ]
          },
          {
            type: 'delete_block',
            blockId: staleBlock?.blockId || 'missing-stale'
          },
          {
            type: 'update_table_cell',
            blockId: ownerCell?.blockId || 'missing-owner-cell',
            content: [
              {
                kind: 'paragraph',
                runs: [{ text: 'Bob' }]
              }
            ]
          }
        ]
      })
      const refreshedSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: apply.newDocId,
        query: 'summary refreshed',
        mode: 'literal'
      })
      const milestoneSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: apply.newDocId,
        query: 'New milestone added',
        mode: 'literal'
      })
      const staleSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string }>
      }>('docx_search', {
        docId: apply.newDocId,
        query: 'Remove this stale note.',
        mode: 'literal'
      })

      return {
        apply,
        refreshedSearch,
        milestoneSearch,
        staleSearch
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.apply.ok && result.apply.changedBlocks.length >= 4, {
      name: 'docx-mixed-edit-apply',
      message: '复杂结构改写应返回至少四处变更'
    })
    runtime.assertThat(result.refreshedSearch.ok && result.refreshedSearch.matches.length === 1, {
      name: 'docx-mixed-edit-refresh-hit',
      message: '替换后的状态段落应可以被搜索到'
    })
    runtime.assertThat(result.milestoneSearch.ok && result.milestoneSearch.matches.length === 1, {
      name: 'docx-mixed-edit-insert-hit',
      message: '插入的新段落应可以被搜索到'
    })
    runtime.assertThat(
      result.apply.changedBlocks.some((block) => block.afterText.includes('Bob')),
      {
        name: 'docx-mixed-edit-table-change',
        message: '更新后的表格负责人应体现在 changedBlocks 中'
      }
    )
    runtime.assertThat(result.staleSearch.ok && result.staleSearch.matches.length === 0, {
      name: 'docx-mixed-edit-delete',
      message: '被删除的旧段落不应再能被搜索到'
    })
  }
})

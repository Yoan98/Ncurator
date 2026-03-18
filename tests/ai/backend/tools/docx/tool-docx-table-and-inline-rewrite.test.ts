import { writeTestDocxFile, createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, findCellBlockContaining } from '../helpers'
import type { DocxOutlineBlock } from '../../../../../src/main/services/ai/tools/docx/types'

defineAiToolCase({
  caseId: 'tool-docx-table-and-inline-rewrite',
  caseType: 'scenario',
  groups: ['docx'],
  description: '同一轮操作中同时修改表格单元格与正文中的局部文本。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/table-inline.docx', [
      { type: 'heading', text: 'Review Plan', level: 1 },
      { type: 'paragraph', text: 'Owner Alice will send the report on Friday.' },
      {
        type: 'table',
        rows: [
          ['Task', 'Owner'],
          ['Review', 'Alice']
        ]
      }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/table-inline.docx'
      })
      const outline = await harness.invoke<{ ok: boolean; blocks: DocxOutlineBlock[] }>(
        'docx_outline',
        {
          docId: open.docId,
          includeTables: true,
          includeCells: true
        }
      )
      const ownerCell = findCellBlockContaining(outline.blocks, 'Alice')
      const apply = await harness.invoke<{
        ok: boolean
        newDocId: string
      }>('docx_apply_ops', {
        docId: open.docId,
        ops: [
          {
            type: 'update_table_cell',
            blockId: ownerCell?.blockId || 'missing-owner-cell',
            content: [
              {
                kind: 'paragraph',
                runs: [{ text: 'Bob' }]
              }
            ]
          },
          {
            type: 'replace_text',
            query: 'Alice',
            replace: 'Bob',
            replaceAll: true
          }
        ]
      })
      const bobSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: apply.newDocId,
        query: 'Bob',
        mode: 'literal'
      })
      const aliceSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string }>
      }>('docx_search', {
        docId: apply.newDocId,
        query: 'Alice',
        mode: 'literal'
      })

      return {
        apply,
        bobSearch,
        aliceSearch
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.apply.ok, {
      name: 'docx-table-inline-apply',
      message: '表格与正文混合改写应成功执行'
    })
    runtime.assertThat(result.bobSearch.ok && result.bobSearch.matches.length >= 2, {
      name: 'docx-table-inline-bob',
      message: 'Bob 应同时出现在正文和表格中'
    })
    runtime.assertThat(result.aliceSearch.ok && result.aliceSearch.matches.length === 0, {
      name: 'docx-table-inline-alice-cleared',
      message: 'Alice 在改写后不应残留'
    })
  }
})

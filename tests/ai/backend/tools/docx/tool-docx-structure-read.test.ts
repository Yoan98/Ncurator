import type { DocxOutlineBlock } from '../../../../../src/main/services/ai/tools/docx/types'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import {
  defineAiToolCase,
  findOutlineBlockContaining,
  getEventsByType
} from '../helpers'

defineAiToolCase({
  caseId: 'tool-docx-structure-read',
  caseType: 'basic',
  groups: ['docx'],
  description: '读取带标题、正文和表格的文档，并完成 open/outline/search/get_block 基线校验。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/structure-read.docx', [
      { type: 'heading', text: 'Quarterly Status', level: 1 },
      { type: 'paragraph', text: 'Project status is on track.' },
      { type: 'paragraph', text: 'Risk owner should confirm integration timing.' },
      {
        type: 'table',
        rows: [
          ['Topic', 'Owner'],
          ['Risk owner', 'Alice']
        ]
      }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{
        ok: boolean
        docId: string
        stats: { blockCount: number }
      }>('docx_open', {
        sourcePath: 'docs/structure-read.docx'
      })
      const outline = await harness.invoke<{
        ok: boolean
        blocks: DocxOutlineBlock[]
      }>('docx_outline', {
        docId: open.docId,
        maxBlocks: 50,
        includeTables: true,
        includeCells: true
      })
      const titleBlock = findOutlineBlockContaining(outline.blocks, 'Quarterly Status')
      const block = await harness.invoke<{
        ok: boolean
        block: { type: string; text?: string }
      }>('docx_get_block', {
        docId: open.docId,
        blockId: titleBlock?.blockId || 'missing-block'
      })
      const search = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'Risk owner',
        mode: 'literal'
      })

      return {
        open,
        outline,
        block,
        search,
        activities: harness.activities,
        toolEvents: getEventsByType(runtime, 'tool_call_started')
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.open.ok, {
      name: 'docx-open-ok',
      message: 'docx_open 应成功打开样例文档'
    })
    runtime.assertThat(result.open.stats.blockCount >= 4, {
      name: 'docx-open-block-count',
      message: '打开后的 block 统计应覆盖标题、正文和表格'
    })
    runtime.assertThat(result.outline.ok, {
      name: 'docx-outline-ok',
      message: 'docx_outline 应成功返回结构'
    })
    runtime.assertThat(
      result.outline.blocks.some((block) => block.type === 'paragraph' && block.text.includes('Quarterly Status')),
      {
        name: 'docx-outline-heading-present',
        message: '结构结果中应包含标题段落'
      }
    )
    runtime.assertThat(
      result.outline.blocks.some((block) => block.type === 'table') &&
        result.outline.blocks.some((block) => block.type === 'table_cell' && block.text.includes('Alice')),
      {
        name: 'docx-outline-table-present',
        message: '结构结果中应包含表格与单元格块'
      }
    )
    runtime.assertThat(result.block.ok && result.block.block.type === 'paragraph', {
      name: 'docx-get-block-heading',
      message: 'docx_get_block 应返回标题段落详情'
    })
    runtime.assertThat(result.search.ok && result.search.matches.length >= 2, {
      name: 'docx-search-literal-matches',
      message: 'docx_search 应命中正文和表格中的 Risk owner'
    })
    runtime.assertThat(result.activities.length >= 2 && result.toolEvents.length === 4, {
      name: 'docx-activity-and-events',
      message: '本用例应记录完整的工具调用事件'
    })
  }
})

import type { DocxOutlineBlock } from '../../../../../../src/main/services/ai/tools/docx/types'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, findParagraphBlockContaining } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-docx-targeting-and-ambiguous-search',
  caseType: 'basic',
  groups: ['docx', 'basic'],
  description: '相似标题与相似段落同时命中时，仍能借助 blockId 稳定定位目标块。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/ambiguous-search.docx', [
      { type: 'heading', text: 'Delivery Risks', level: 1 },
      { type: 'paragraph', text: 'Action owner: Alice will confirm vendor fallback.' },
      { type: 'heading', text: 'Delivery Risks Review', level: 2 },
      { type: 'paragraph', text: 'Action owner: Bob will review release timing.' }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/ambiguous-search.docx'
      })
      const outline = await harness.invoke<{ ok: boolean; blocks: DocxOutlineBlock[] }>(
        'docx_outline',
        {
          docId: open.docId,
          includeTables: true,
          includeCells: true
        }
      )
      const headingSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'Delivery Risks',
        mode: 'literal'
      })
      const paragraphSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'Action owner',
        mode: 'literal'
      })
      const targetParagraph = findParagraphBlockContaining(outline.blocks, 'Bob will review release timing.')
      const block = await harness.invoke<{
        ok: boolean
        block: { type: string; text?: string }
      }>('docx_get_block', {
        docId: open.docId,
        blockId: targetParagraph?.blockId || 'missing-block'
      })

      return {
        headingSearch,
        paragraphSearch,
        targetParagraph,
        block
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.headingSearch.ok && result.headingSearch.matches.length === 2, {
      name: 'docx-ambiguous-heading-hit',
      message: '相似标题搜索应返回两个候选块'
    })
    runtime.assertThat(result.paragraphSearch.ok && result.paragraphSearch.matches.length === 2, {
      name: 'docx-ambiguous-paragraph-hit',
      message: '相似段落搜索应返回两个候选块'
    })
    runtime.assertThat(Boolean(result.targetParagraph), {
      name: 'docx-target-paragraph-found',
      message: '应能从 outline 中精确找到目标段落'
    })
    runtime.assertThat(
      result.block.ok && result.block.block.type === 'paragraph' && result.block.block.text?.includes('Bob'),
      {
        name: 'docx-target-block-loaded',
        message: 'docx_get_block 应稳定读取目标段落，而不是命中 Alice 段落'
      }
    )
  }
})

import type { DocxOutlineBlock } from '../../../../../../src/main/services/ai/tools/docx/types'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, findParagraphBlockContaining } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-docx-search-modes-and-scope',
  caseType: 'basic',
  groups: ['docx', 'basic'],
  description: '覆盖 literal/regex/semantic 搜索以及 block scope 局部收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/search-modes.docx', [
      { type: 'heading', text: 'Integration', level: 1 },
      { type: 'paragraph', text: 'Integration issue needs mitigation before release.' },
      { type: 'heading', text: 'Operations', level: 1 },
      { type: 'paragraph', text: 'Operations issue is tracked separately.' },
      { type: 'paragraph', text: 'Phase 1 completed.' },
      { type: 'paragraph', text: 'Phase 2 pending.' }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/search-modes.docx'
      })
      const outline = await harness.invoke<{ ok: boolean; blocks: DocxOutlineBlock[] }>(
        'docx_outline',
        {
          docId: open.docId
        }
      )
      const operationsBlock = findParagraphBlockContaining(outline.blocks, 'Operations issue is tracked separately.')
      const literal = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'issue',
        mode: 'literal'
      })
      const regex = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'Phase [12]',
        mode: 'regex'
      })
      const semantic = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'integration mitigation',
        mode: 'semantic'
      })
      const scopedLiteral = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: open.docId,
        query: 'issue',
        mode: 'literal',
        scope: {
          blockIds: operationsBlock ? [operationsBlock.blockId] : []
        }
      })

      return {
        literal,
        regex,
        semantic,
        scopedLiteral
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.literal.ok && result.literal.matches.length === 2, {
      name: 'docx-search-literal',
      message: 'literal 搜索应命中两个 issue 段落'
    })
    runtime.assertThat(result.regex.ok && result.regex.matches.length === 2, {
      name: 'docx-search-regex',
      message: 'regex 搜索应命中两个 Phase 段落'
    })
    runtime.assertThat(
      result.semantic.ok &&
        result.semantic.matches.length >= 1 &&
        result.semantic.matches[0].text.includes('Integration issue'),
      {
        name: 'docx-search-semantic',
        message: 'semantic 搜索应优先返回 integration mitigation 段落'
      }
    )
    runtime.assertThat(
      result.scopedLiteral.ok &&
        result.scopedLiteral.matches.length === 1 &&
        result.scopedLiteral.matches[0].text.includes('Operations issue'),
      {
        name: 'docx-search-scope',
        message: 'scope.blockIds 应把搜索范围限制在目标块内'
      }
    )
  }
})

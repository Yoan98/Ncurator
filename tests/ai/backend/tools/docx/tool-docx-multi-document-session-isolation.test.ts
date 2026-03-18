import fs from 'node:fs/promises'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../helpers'

defineAiToolCase({
  caseId: 'tool-docx-multi-document-session-isolation',
  caseType: 'scenario',
  groups: ['docx'],
  description: '同一 run 打开多份文档后，显式 docId 操作不会串到其他文档。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/alpha.docx', [
      { type: 'heading', text: 'Alpha Plan', level: 1 },
      { type: 'paragraph', text: 'Alpha owner Alice tracks the rollout.' }
    ])
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/beta.docx', [
      { type: 'heading', text: 'Beta Plan', level: 1 },
      { type: 'paragraph', text: 'Beta owner Bob tracks the audit.' }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const alpha = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/alpha.docx'
      })
      const beta = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/beta.docx'
      })
      const defaultSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        query: 'Beta owner',
        mode: 'literal'
      })
      const alphaApply = await harness.invoke<{
        ok: boolean
        newDocId: string
      }>('docx_apply_ops', {
        docId: alpha.docId,
        ops: [
          {
            type: 'replace_text',
            query: 'Alice',
            replace: 'Carol',
            replaceAll: true
          }
        ]
      })
      const alphaSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: alphaApply.newDocId,
        query: 'Carol',
        mode: 'literal'
      })
      const betaSearch = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: beta.docId,
        query: 'Carol',
        mode: 'literal'
      })
      const alphaSave = await harness.invoke<{
        ok: boolean
        outPath: string
      }>('docx_save', {
        docId: alphaApply.newDocId,
        outPath: 'exports/alpha-final.docx'
      })
      const betaSave = await harness.invoke<{
        ok: boolean
        outPath: string
      }>('docx_save', {
        docId: beta.docId,
        outPath: 'exports/beta-final.docx'
      })
      await fs.stat(alphaSave.outPath)
      await fs.stat(betaSave.outPath)

      return {
        defaultSearch,
        alphaSearch,
        betaSearch,
        alphaSave,
        betaSave
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.defaultSearch.ok &&
        result.defaultSearch.matches.length === 1 &&
        result.defaultSearch.matches[0].text.includes('Beta owner'),
      {
        name: 'docx-session-last-doc-default',
        message: '未传 docId 时，应默认操作最后打开的 beta 文档'
      }
    )
    runtime.assertThat(result.alphaSearch.ok && result.alphaSearch.matches.length === 1, {
      name: 'docx-session-alpha-updated',
      message: '对 alpha 的显式修改应只影响 alpha 文档'
    })
    runtime.assertThat(result.betaSearch.ok && result.betaSearch.matches.length === 0, {
      name: 'docx-session-beta-isolated',
      message: 'beta 文档不应被 alpha 的修改串写'
    })
    runtime.assertThat(result.alphaSave.ok && result.betaSave.ok, {
      name: 'docx-session-save-both',
      message: '两份文档都应能独立保存'
    })
  }
})

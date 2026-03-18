import fs from 'node:fs/promises'
import type { DocxOutlineBlock } from '../../../../../../src/main/services/ai/tools/docx/types'
import { writeTestDocxFile, createDocxToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, findParagraphBlockContaining } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-docx-preview-validate-rollback',
  caseType: 'boundary',
  groups: ['docx', 'boundary'],
  description: '多轮编辑后执行 preview、validate、history 与 rollback 收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/preview-rollback.docx', [
      { type: 'heading', text: 'Draft Report', level: 1 },
      { type: 'paragraph', text: 'Draft v1 is ready for review.' }
    ])

    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/preview-rollback.docx'
      })
      const outline = await harness.invoke<{ ok: boolean; blocks: DocxOutlineBlock[] }>(
        'docx_outline',
        {
          docId: open.docId
        }
      )
      const bodyBlock = findParagraphBlockContaining(outline.blocks, 'Draft v1 is ready for review.')
      const apply = await harness.invoke<{
        ok: boolean
        newDocId: string
      }>('docx_apply_ops', {
        docId: open.docId,
        ops: [
          {
            type: 'replace_block',
            blockId: bodyBlock?.blockId || 'missing-body',
            content: {
              kind: 'paragraph',
              runs: [{ text: 'Draft v2 is ready for final review.' }]
            }
          }
        ]
      })
      const history = await harness.invoke<{
        ok: boolean
        snapshots: Array<{ docId: string }>
      }>('docx_get_history', {
        docId: apply.newDocId,
        maxDepth: 5
      })
      const preview = await harness.invoke<{
        ok: boolean
        previewPath: string
        format: string
      }>('docx_render_preview', {
        docId: apply.newDocId,
        format: 'html'
      })
      const validate = await harness.invoke<{
        ok: boolean
        problems: Array<{ code: string; message: string }>
      }>('docx_validate', {
        docId: apply.newDocId
      })
      const rollback = await harness.invoke<{
        ok: boolean
        docId: string
        previousDocId: string
        stepsApplied: number
      }>('docx_rollback', {
        docId: apply.newDocId,
        steps: 1
      })
      const v1Search = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string }>
      }>('docx_search', {
        docId: rollback.docId,
        query: 'Draft v1',
        mode: 'literal'
      })
      const v2Search = await harness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string }>
      }>('docx_search', {
        docId: rollback.docId,
        query: 'Draft v2',
        mode: 'literal'
      })
      await fs.stat(preview.previewPath)

      return {
        history,
        preview,
        validate,
        rollback,
        v1Search,
        v2Search
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.history.ok && result.history.snapshots.length === 2, {
      name: 'docx-history-two-snapshots',
      message: '一次编辑后应保留原始与新快照两条历史'
    })
    runtime.assertThat(result.preview.ok && result.preview.format === 'html', {
      name: 'docx-preview-generated',
      message: 'html preview 应成功生成'
    })
    runtime.assertThat(result.validate.ok && result.validate.problems.length === 0, {
      name: 'docx-validate-clean',
      message: '修改后的文档应通过 validate'
    })
    runtime.assertThat(result.rollback.ok && result.rollback.stepsApplied === 1, {
      name: 'docx-rollback-one-step',
      message: 'rollback 应能退回上一版快照'
    })
    runtime.assertThat(
      result.v1Search.ok &&
        result.v1Search.matches.length === 1 &&
        result.v2Search.ok &&
        result.v2Search.matches.length === 0,
      {
        name: 'docx-rollback-restored-content',
        message: '回滚后应恢复 v1 文本，并移除 v2 文本'
      }
    )
  }
})

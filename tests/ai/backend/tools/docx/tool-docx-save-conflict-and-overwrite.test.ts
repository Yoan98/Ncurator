import fs from 'node:fs/promises'
import { createDocxToolHarness, writeWorkbenchSampleDocx } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, getEventsByType } from '../helpers'

defineAiToolCase({
  caseId: 'tool-docx-save-conflict-and-overwrite',
  caseType: 'scenario',
  groups: ['docx'],
  description: '覆盖首次保存、冲突保存和 overwrite 审批后的再次保存。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docs/save-conflict.docx')
    const harness = createDocxToolHarness(runtime)
    try {
      const open = await harness.invoke<{ ok: boolean; docId: string }>('docx_open', {
        sourcePath: 'docs/save-conflict.docx'
      })
      const firstSave = await harness.invoke<{
        ok: boolean
        outPath: string
        operation: string
      }>('docx_save', {
        docId: open.docId,
        outPath: 'exports/final.docx'
      })
      const conflictSave = await harness.invoke<{
        ok: boolean
        code: string
        error?: string
      }>('docx_save', {
        docId: open.docId,
        outPath: 'exports/final.docx'
      })
      const overwriteSave = await harness.invoke<{
        ok: boolean
        outPath: string
        operation: string
      }>('docx_save', {
        docId: open.docId,
        outPath: 'exports/final.docx',
        overwrite: true
      })
      await fs.stat(firstSave.outPath)

      return {
        firstSave,
        conflictSave,
        overwriteSave,
        approvalEvents: getEventsByType(runtime, 'approval_required'),
        artifactEvents: getEventsByType(runtime, 'file_artifact')
      }
    } finally {
      await harness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.firstSave.ok && result.firstSave.operation === 'created', {
      name: 'docx-save-created',
      message: '首次保存应创建新的 docx 文件'
    })
    runtime.assertThat(
      !result.conflictSave.ok && result.conflictSave.code === 'invalid_input',
      {
        name: 'docx-save-conflict',
        message: '重复保存且未开启 overwrite 时应返回冲突错误'
      }
    )
    runtime.assertThat(result.overwriteSave.ok && result.overwriteSave.operation === 'updated', {
      name: 'docx-save-overwrite',
      message: '开启 overwrite 后应更新已存在的目标文件'
    })
    runtime.assertThat(result.approvalEvents.length === 1 && result.artifactEvents.length === 2, {
      name: 'docx-save-events',
      message: 'overwrite 保存应触发一次审批，并记录两次文件产物事件'
    })
  }
})

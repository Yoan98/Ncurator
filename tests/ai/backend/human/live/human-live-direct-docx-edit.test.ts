import fs from 'node:fs/promises'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanLiveCase,
  getEventsByType,
  loadPrimaryLiveHumanConfig
} from '../helpers'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

defineAiHumanLiveCase({
  caseId: 'human-live-direct-docx-edit',
  caseType: 'live',
  groups: ['live'],
  description: 'live 模型直接完成 docx 改写并生成可审阅预览。',
  fixtures: [],
  runMode: 'single',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'weekly-report.docx', [
      { type: 'heading', text: 'NCurator Weekly Report', level: 1 },
      { type: 'paragraph', text: 'Project status is on track.' },
      { type: 'paragraph', text: 'Risk summary: monitor integration edge cases.' },
      {
        type: 'table',
        rows: [
          ['Topic', 'Owner'],
          ['Risk', 'Alice']
        ]
      }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        liveModelConfig: loadPrimaryLiveHumanConfig()
      },
      { maxSteps: 8 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective:
          '请打开 weekly-report.docx，把 Risk summary 改成 “Risk summary: integration regression is assigned to Bob for daily follow-up.”，并把表格里 Risk 的 Owner 改成 Bob。完成后生成可审阅 preview，并用 handoff 形式交付。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewArtifact = fileArtifacts.find((event) => event.artifactRole === 'preview')
    const previewPath = previewArtifact?.path || ''
    const previewExists = previewPath ? await fileExists(previewPath) : false
    const inspectionHarness = createDocxToolHarness(runtime)

    try {
      const openPreview = await inspectionHarness.invoke<{
        ok: boolean
        docId: string
      }>('docx_open', {
        sourcePath: previewPath
      })
      const riskSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'integration regression is assigned to Bob for daily follow-up',
        mode: 'literal'
      })
      const ownerSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Bob',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        riskSearch,
        ownerSearch,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started')
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-live-docx-edit-completed',
        message: 'live human docx 改写应形成完成态交付'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.riskSearch.ok &&
        result.riskSearch.matches.length >= 1 &&
        result.ownerSearch.ok &&
        result.ownerSearch.matches.length >= 1,
      {
        name: 'human-live-docx-edit-preview',
        message: 'live human 改写后的 preview 应包含新的风险摘要与负责人'
      }
    )
    runtime.assertThat(
      result.toolCalls.some((event) => event.toolName === 'docx_open') &&
        result.toolCalls.some((event) => event.toolName === 'docx_apply_ops') &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview'),
      {
        name: 'human-live-docx-edit-events',
        message: 'live human 应留下 docx 打开、编辑和 preview 证据'
      }
    )
  }
})

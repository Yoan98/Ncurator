import fs from 'node:fs/promises'
import type { AiRunEvent, JsonObject } from '../../../../../src/shared/types'
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

const getToolOutputPreview = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): JsonObject | null => {
  const value = event.outputPreview
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  return value as JsonObject
}

defineAiHumanLiveCase({
  caseId: 'human-live-terminal-docx-handoff',
  caseType: 'live',
  groups: ['live'],
  description: 'live 模型先读取 workspace 材料，再写入 docx 预览并交付。',
  fixtures: ['tests/fixtures/ai/workspace/materials/daily/2026-03-16-note.md'],
  runMode: 'single',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'weekly-brief.docx', [
      { type: 'heading', text: 'Weekly Brief', level: 1 },
      { type: 'paragraph', text: 'Summary: pending material import.' },
      { type: 'paragraph', text: 'Risk owner: TBD.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        liveModelConfig: loadPrimaryLiveHumanConfig()
      },
      { maxSteps: 12 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective:
          '请先读取 ai/workspace/materials/daily/2026-03-16-note.md，不要读取其他材料。拿到结论后不要使用 KB，也不需要 save；直接打开 weekly-brief.docx，把 “Summary: pending material import.” 替换成 “Summary: Integration review completed. approval flow still needs regression coverage.”，生成可审阅 preview，并用 handoff 形式交付。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    const toolResults = getEventsByType(runtime, 'tool_call_result')
    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewArtifact = fileArtifacts.find((event) => event.artifactRole === 'preview')
    const previewPath = previewArtifact?.path || ''
    const previewExists = previewPath ? await fileExists(previewPath) : false

    if (!previewExists) {
      return {
        output,
        previewExists,
        previewPath,
        summarySearch: { ok: false, matches: [] },
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        toolResults
      }
    }

    const inspectionHarness = createDocxToolHarness(runtime)

    try {
      const openPreview = await inspectionHarness.invoke<{
        ok: boolean
        docId: string
      }>('docx_open', {
        sourcePath: previewPath
      })
      const summarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'approval flow still needs regression coverage',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        previewPath,
        summarySearch,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        toolResults
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const terminalPreviewTexts = result.toolResults
      .filter((event) => event.toolName === 'terminal_run_command')
      .map((event) => getToolOutputPreview(event))
      .filter((value): value is JsonObject => value !== null)
      .map((value) => String(value.outputPreview || ''))

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-live-terminal-docx-completed',
        message: 'live human 的 terminal -> docx handoff 应形成完成态交付'
      }
    )
    runtime.assertThat(
      terminalPreviewTexts.some((text) => text.includes('Integration review completed')) &&
        result.previewExists &&
        result.summarySearch.ok &&
        result.summarySearch.matches.length >= 1,
      {
        name: 'human-live-terminal-docx-preview',
        message: 'live human 应先读取 workspace 材料，再把结论写入 preview',
        data: {
          previewExists: result.previewExists,
          previewPath: result.previewPath,
          summarySearchOk: result.summarySearch.ok,
          summaryMatchCount: result.summarySearch.matches.length,
          terminalPreviewTexts,
          toolNames: result.toolCalls.map((event) => event.toolName),
          summary: result.output.summary,
          resultData: result.output.resultData
        }
      }
    )
    runtime.assertThat(
      result.toolCalls.some((event) => event.toolName === 'terminal_run_command') &&
        result.toolCalls.some((event) => event.toolName === 'docx_apply_ops') &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview'),
      {
        name: 'human-live-terminal-docx-events',
        message: 'live human 应留下 terminal 取材和 docx 交付证据'
      }
    )
  }
})

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
      { maxSteps: 10 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective:
          '请先读取 ai/workspace/materials/daily/2026-03-16-note.md，再把其中的结论写入 weekly-brief.docx。最终摘要里必须包含 “Integration review completed” 和 “approval flow still needs regression coverage”，并生成可审阅 preview。'
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
        message: 'live human 应先读取 workspace 材料，再把结论写入 preview'
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

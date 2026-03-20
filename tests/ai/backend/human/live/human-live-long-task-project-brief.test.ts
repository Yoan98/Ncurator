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
  caseId: 'human-live-long-task-project-brief',
  caseType: 'live',
  groups: ['live'],
  description: 'live 模型在较高步数预算下完成 workspace 材料归并到 docx brief 的长任务。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-2.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-3.txt',
    'tests/fixtures/ai/workspace/materials/weekly/risk-summary.txt'
  ],
  runMode: 'single',
  execute: async (runtime) => {
    let trackedPreviewPath = ''

    await writeTestDocxFile(runtime.workspaceRoot, 'project-brief.docx', [
      { type: 'heading', text: 'Project Brief', level: 1 },
      { type: 'paragraph', text: 'Summary: pending synthesis.' },
      { type: 'paragraph', text: 'Risk summary: pending synthesis.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        trackDocxPreview: ({ previewPath }) => {
          trackedPreviewPath = previewPath
        },
        liveModelConfig: loadPrimaryLiveHumanConfig()
      },
      { hardActionLimit: 14 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        userInput:
          '请读取 ai/workspace/materials/batch/day-1.txt、day-2.txt、day-3.txt 和 ai/workspace/materials/weekly/risk-summary.txt，整理成 project-brief.docx 的可审阅 preview。摘要需要概括 workspace scan baseline、KB retrieval baseline、docx review handoff baseline，风险部分需要提到 approval branch requires explicit denial coverage。'
      }
    )

    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewPath = trackedPreviewPath
    const previewExists = previewPath ? await fileExists(previewPath) : false
    const inspectionHarness = createDocxToolHarness(runtime)

    try {
      const openPreview = await inspectionHarness.invoke<{
        ok: boolean
        docId: string
      }>('docx_open', {
        sourcePath: previewPath
      })
      const baselineSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'workspace scan baseline',
        mode: 'literal'
      })
      const riskSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'explicit denial coverage',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        baselineSearch,
        riskSearch,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        terminalSteps: getEventsByType(runtime, 'terminal_step_started')
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed',
      {
        name: 'human-live-long-task-completed',
        message: 'live human 长任务应形成可交付的 brief'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.baselineSearch.ok &&
        result.baselineSearch.matches.length >= 1 &&
        result.riskSearch.ok &&
        result.riskSearch.matches.length >= 1,
      {
        name: 'human-live-long-task-preview',
        message: 'live human 长任务产出的 preview 应包含进展摘要与风险结论'
      }
    )
    runtime.assertThat(
      result.terminalSteps.length >= 2 &&
        result.toolCalls.some((event) => event.toolName === 'terminal_run_command') &&
        result.toolCalls.some((event) => event.toolName === 'docx_apply_ops') &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview'),
      {
        name: 'human-live-long-task-events',
        message: 'live human 长任务应同时留下多次材料读取和 docx 交付证据'
      }
    )
  }
})

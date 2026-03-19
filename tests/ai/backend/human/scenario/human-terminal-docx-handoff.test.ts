import fs from 'node:fs/promises'
import type { AiRunEvent, JsonObject } from '../../../../../src/shared/types'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

const getToolOutputPreview = (event: Extract<AiRunEvent, { type: 'tool_call_result' }>): JsonObject | null => {
  const value = event.outputPreview
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  return value as JsonObject
}

defineAiHumanCase({
  caseId: 'human-terminal-docx-handoff',
  caseType: 'scenario',
  groups: ['scenario'],
  description: 'human 先在 workspace 取材，再写入 docx 预览并形成可审阅交付。',
  fixtures: ['tests/fixtures/ai/workspace/materials/daily/2026-03-16-note.md'],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'weekly-brief.docx', [
      { type: 'heading', text: 'Weekly Brief', level: 1 },
      { type: 'paragraph', text: 'Summary: pending material import.' },
      { type: 'paragraph', text: 'Risk owner: TBD.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '先从 workspace 材料里抽取事实。',
              publicNarrative: '我先读取工作区材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/daily/2026-03-16-note.md'
              },
              rationale: '先读取最新日报。',
              publicNarrative: '我正在提取日报里的可复用事实。'
            }
          },
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '取材后切换到 docx 编辑。',
              publicNarrative: '我现在把材料写入周报文档。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'weekly-brief.docx'
              },
              rationale: '先打开模板文档。',
              publicNarrative: '我正在打开周报模板。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_apply_ops',
              args: {
                ops: [
                  {
                    type: 'replace_text',
                    query: 'Summary: pending material import.',
                    replace:
                      'Summary: Integration review completed. Risk: approval flow still needs regression coverage.'
                  }
                ]
              },
              rationale: '把日报中的结论写进摘要段落。',
              publicNarrative: '我正在把 workspace 材料转成文档摘要。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '生成可审阅预览。',
              publicNarrative: '我先生成文档预览，便于后续审阅。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '确认结构有效。',
              publicNarrative: '我正在校验文档结构。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '已从 workspace 材料提炼结论并写入周报预览。',
              rationale: 'terminal 取材与 docx handoff 已完成。',
              publicNarrative: '我已经完成取材到文档预览的交付。',
              resultData: {
                document_name: 'weekly-brief.docx',
                artifact_role: 'preview',
                handoff_summary:
                  'Integration review completed; approval flow still needs regression coverage.'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ resultData, summary }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `交付形式：${typeof resultData?.artifact_role === 'string' ? resultData.artifact_role : 'preview'}`
          ].join('\n')
      },
      { hardActionLimit: 9 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '先读取 workspace 日报，再把结论写进周报 docx。'
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
        previewPath,
        summarySearch,
        humanSteps: getEventsByType(runtime, 'human_step'),
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        toolResults,
        fileArtifacts
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const terminalResult = result.toolResults.find((event) => event.toolName === 'terminal_run_command')
    const terminalPreview = terminalResult ? getToolOutputPreview(terminalResult) : null

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.artifact_role === 'preview',
      {
        name: 'human-terminal-docx-handoff-completed',
        message: 'terminal -> docx handoff 应形成完成态交付'
      }
    )
    runtime.assertThat(
      Boolean(terminalPreview) &&
        String(terminalPreview?.outputPreview || '').includes('Integration review completed') &&
        String(terminalPreview?.outputPreview || '').includes('approval flow'),
      {
        name: 'human-terminal-docx-handoff-materials',
        message: 'human 应先从 terminal 读取到可复用的日报事实'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.summarySearch.ok &&
        result.summarySearch.matches.length >= 1,
      {
        name: 'human-terminal-docx-handoff-preview',
        message: '预览文档中应写入从 workspace 材料提炼出的结论'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 5)
        .map((event) => event.toolName)
        .join(',') ===
        [
          'terminal_run_command',
          'docx_open',
          'docx_apply_ops',
          'docx_render_preview',
          'docx_validate'
        ].join(','),
      {
        name: 'human-terminal-docx-handoff-order',
        message: 'human 应先取材，再按 docx 编辑链路生成预览'
      }
    )
    runtime.assertThat(
      result.humanSteps.filter((event) => event.action === 'load_skill').length === 2 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-terminal-docx-handoff-events',
        message: '事件流应体现 terminal 与 docx 的跨工具 handoff'
      }
    )
  }
})

import fs from 'node:fs/promises'
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

defineAiHumanCase({
  caseId: 'human-multi-turn-refinement',
  caseType: 'scenario',
  groups: ['scenario'],
  description: '已有中间产物时，human 应围绕已有版本做局部 refinement，而不是重做整份文档。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'followup-brief.docx', [
      { type: 'heading', text: 'Weekly Brief Follow-up', level: 1 },
      { type: 'paragraph', text: 'Summary: Integration review completed.' },
      { type: 'paragraph', text: 'Risk note: approval flow still needs regression coverage.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '这是上一轮已经产出的中间稿，本轮只做局部 refinement。',
              publicNarrative: '我先打开已有文档，只修改需要收敛的局部内容。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'followup-brief.docx'
              },
              rationale: '沿用上一轮文档继续修改。',
              publicNarrative: '我正在打开上一轮的中间稿。'
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
                    query: 'Risk note: approval flow still needs regression coverage.',
                    replace:
                      'Risk note: approval flow still needs regression coverage before sign-off, so keep the release note conservative.'
                  }
                ]
              },
              rationale: '本轮只把风险表述改得更保守，不重写整个 brief。',
              publicNarrative: '我正在基于已有版本做局部保守化 refinement。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '生成新的可审阅版本。',
              publicNarrative: '我先生成 refinement 后的预览。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '确认只做局部 refinement 后结构仍有效。',
              publicNarrative: '我正在校验 refinement 后的文档结构。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '已基于上一轮中间稿完成局部 refinement，并生成新的预览。',
              rationale: 'follow-up 任务已经围绕已有版本完成保守化更新。',
              publicNarrative: '我已经基于已有版本完成 follow-up refinement。',
              resultData: {
                document_name: 'followup-brief.docx',
                artifact_role: 'preview',
                refinement_kind: 'follow_up_conservative_update'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `Refinement 类型：${typeof resultData?.refinement_kind === 'string' ? resultData.refinement_kind : 'follow_up_conservative_update'}`,
            '说明：本轮沿用上一版文档，只对风险表述做了局部保守化处理。'
          ].join('\n')
      },
      { hardActionLimit: 8 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '继续刚才那版 weekly brief，把风险部分改得更保守一点，不要整份重写。'
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
      const conservativeSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'keep the release note conservative',
        mode: 'literal'
      })
      const summarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Summary: Integration review completed.',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        conservativeSearch,
        summarySearch,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        humanSteps: getEventsByType(runtime, 'human_step')
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.refinement_kind === 'follow_up_conservative_update',
      {
        name: 'human-multi-turn-refinement-completed',
        message: 'follow-up refinement 应形成完成态交付'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.conservativeSearch.ok &&
        result.conservativeSearch.matches.length >= 1 &&
        result.summarySearch.ok &&
        result.summarySearch.matches.length >= 1,
      {
        name: 'human-multi-turn-refinement-preview',
        message: 'refinement 后的 preview 应保留原有摘要，并更新局部风险表述'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 4)
        .map((event) => event.toolName)
        .join(',') ===
        ['docx_open', 'docx_apply_ops', 'docx_render_preview', 'docx_validate'].join(','),
      {
        name: 'human-multi-turn-refinement-order',
        message: 'follow-up refinement 应围绕已有文档执行最小编辑链路'
      }
    )
    runtime.assertThat(
      result.humanSteps.filter((event) => event.action === 'load_skill').length === 1 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-multi-turn-refinement-events',
        message: '事件流应体现这是围绕已有中间稿的单文档 refinement'
      }
    )
  }
})

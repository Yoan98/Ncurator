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
  caseId: 'human-review-handoff-structured-delivery',
  caseType: 'scenario',
  groups: ['scenario'],
  description: '文档修改完成后，human 应输出稳定的 review handoff 结构化交付。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let trackedPreviewPath = ''

    await writeTestDocxFile(runtime.workspaceRoot, 'review-ready.docx', [
      { type: 'heading', text: 'Iteration Review', level: 1 },
      { type: 'paragraph', text: 'Summary: pending review update.' },
      { type: 'paragraph', text: 'Risk owner: TBD.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        trackDocxPreview: ({ previewPath }) => {
          trackedPreviewPath = previewPath
        },
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillIds: ['docx-read', 'docx-write', 'docx-delivery'],
              rationale: '先加载文档编辑能力。',
              publicNarrative: '我先打开文档并整理审阅稿。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'review-ready.docx'
              },
              rationale: '先拿到 docId。',
              publicNarrative: '我正在打开待审阅文档。'
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
                    query: 'Summary: pending review update.',
                    replace: 'Summary: draft review handoff is ready for editor verification.'
                  }
                ]
              },
              rationale: '先把摘要改成当前审阅结论。',
              publicNarrative: '我正在把本轮变更写进审阅稿。'
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
              publicNarrative: '我先生成预览，方便进入后续审阅。'
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
              summary: '文档改写已完成，当前交付已具备 review handoff 条件。',
              rationale: '预览和校验都已完成，可以进入结构化 handoff。',
              publicNarrative: '我已经整理好可继续审阅的交付。'
            }
          }
        ],
        humanDeliveryOverride: ({ summary }) => {
          return [
            '# 子任务交付',
            '',
            '## 已完成',
            summary,
            '',
            '## 关键发现',
            '- 摘要已更新为 draft review handoff ready。',
            '- 文档已生成 preview 并完成 validate。',
            '',
            '## 证据与来源',
            '- 文档: review-ready.docx',
            '- 交付形态: preview',
            '',
            '## 风险与未决',
            '- 仍需人工进入 draft review 流程做最终接受/拒绝。',
            '',
            '## 建议后续步骤',
            '- 进入 draft_review_ready 并逐条审阅变更。'
          ].join('\n')
        }
      },
      { hardActionLimit: 8 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        userInput: '修改文档后给出可继续进入审阅的结构化 handoff。'
      }
    )

    const deliveries = getEventsByType(runtime, 'task_delivery_ready')
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
      const summarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'draft review handoff is ready',
        mode: 'literal'
      })

      return {
        output,
        deliveries,
        fileArtifacts,
        previewExists,
        summarySearch
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.deliveryMarkdown.includes('draft_review_ready'),
      {
        name: 'human-review-handoff-status',
        message: 'review handoff 应形成完成态并标记为 review_ready'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('## 已完成') &&
        result.output.deliveryMarkdown.includes('## 关键发现') &&
        result.output.deliveryMarkdown.includes('## 证据与来源') &&
        result.output.deliveryMarkdown.includes('## 风险与未决') &&
        result.output.deliveryMarkdown.includes('## 建议后续步骤'),
      {
        name: 'human-review-handoff-structure',
        message: 'review handoff 应输出稳定的结构化交付'
      }
    )
    runtime.assertThat(
      result.deliveries.length === 1 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.previewExists &&
        result.summarySearch.ok &&
        result.summarySearch.matches.length >= 1,
      {
        name: 'human-review-handoff-preview',
        message: 'review handoff 应附带可审阅 preview 证据'
      }
    )
    runtime.assertThat(result.output.deliveryMarkdown.includes('## 证据与来源'), {
      name: 'human-review-handoff-local-source',
      message: 'review handoff 文档交付应保留来源与证据区块'
    })
  }
})

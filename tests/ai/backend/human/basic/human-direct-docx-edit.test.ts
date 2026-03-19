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
  caseId: 'human-direct-docx-edit',
  caseType: 'basic',
  groups: ['basic'],
  description: 'human 直接完成 docx 打开、改写、预览、校验和保存闭环。',
  fixtures: [],
  runMode: 'repeatable',
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
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '先加载文档编辑能力。',
              publicNarrative: '我先打开并检查文档。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'weekly-report.docx'
              },
              rationale: '需要先拿到 docId。',
              publicNarrative: '我正在打开目标文档。'
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
                    query: 'Risk summary: monitor integration edge cases.',
                    replace: 'Risk summary: integration regression is assigned to Bob for daily follow-up.'
                  },
                  {
                    type: 'update_table_cell',
                    blockId: 'tbl:3.r:1.c:1',
                    content: [
                      {
                        kind: 'paragraph',
                        runs: [{ text: 'Bob' }]
                      }
                    ]
                  }
                ]
              },
              rationale: '直接完成正文和表格负责人的更新。',
              publicNarrative: '我正在把风险摘要和负责人一起改好。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '先生成预览，确保改动可审阅。',
              publicNarrative: '我先生成预览确认改动结果。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '保存前先校验文档结构。',
              publicNarrative: '我正在校验文档结构是否正常。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '周报中的风险摘要与负责人已更新，并已生成可审阅预览。',
              rationale: '文档已完成改写、预览和校验。',
              publicNarrative: '我已经完成文档修改并生成了交付结果。',
              resultData: {
                document_name: 'weekly-report.docx',
                artifact_role: 'preview',
                change_summary: '风险摘要改为 Bob 跟进，表格负责人同步更新为 Bob。'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ resultData, summary }) => {
          return [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `交付形式：${typeof resultData?.artifact_role === 'string' ? resultData.artifact_role : 'preview'}`
          ].join('\n')
        }
      },
      { hardActionLimit: 8 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '更新周报中的风险摘要和负责人，并给出可审阅的 docx 结果。'
      }
    )

    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewArtifact = fileArtifacts.find((event) => event.artifactRole === 'preview')
    const previewPath = previewArtifact?.path || ''
    const previewExists = previewPath ? await fileExists(previewPath) : false
    const inspectionHarness = createDocxToolHarness(runtime)

    try {
      const openSaved = await inspectionHarness.invoke<{
        ok: boolean
        docId: string
      }>('docx_open', {
        sourcePath: previewPath
      })
      const riskSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openSaved.docId,
        query: 'integration regression is assigned to Bob',
        mode: 'literal'
      })
      const ownerSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openSaved.docId,
        query: 'Bob',
        mode: 'literal'
      })

      runtime.recordEvent({
        type: 'step',
        name: 'inspect-saved-docx',
        status: 'info',
        message: '检查保存后的 docx 内容',
        data: {
          previewExists,
          previewPath,
          openSavedOk: openSaved.ok,
          riskSearch,
          ownerSearch,
          toolResults: getEventsByType(runtime, 'tool_call_result')
        }
      })

      return {
        output,
        previewExists,
        previewPath,
        riskSearch,
        ownerSearch,
        humanSteps: getEventsByType(runtime, 'human_step'),
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        toolResults: getEventsByType(runtime, 'tool_call_result')
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const riskMatchCount = Array.isArray(result.riskSearch.matches) ? result.riskSearch.matches.length : 0
    const ownerMatchCount = Array.isArray(result.ownerSearch.matches) ? result.ownerSearch.matches.length : 0

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-docx-edit-completed',
        message: 'human 应完成 docx 编辑闭环'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.riskSearch.ok &&
        riskMatchCount >= 1 &&
      result.ownerSearch.ok &&
        ownerMatchCount >= 1,
      {
        name: 'human-docx-edit-preview-content',
        message: '可审阅预览应包含新的风险摘要和负责人',
        data: {
          previewExists: result.previewExists,
          previewPath: result.previewPath,
          riskMatchCount,
          ownerMatchCount,
          riskSearchOk: result.riskSearch.ok,
          ownerSearchOk: result.ownerSearch.ok
        }
      }
    )
    runtime.assertThat(
      result.output.resultData?.document_name === 'weekly-report.docx' &&
        result.output.resultData?.artifact_role === 'preview' &&
        result.output.deliveryMarkdown.includes('preview'),
      {
        name: 'human-docx-edit-delivery',
        message: '交付结果应明确这是可审阅预览而不是最终落盘文件'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 4)
        .map((event) => event.toolName)
        .join(',') === ['docx_open', 'docx_apply_ops', 'docx_render_preview', 'docx_validate'].join(','),
      {
        name: 'human-docx-edit-tool-order',
        message: 'human 应按 open -> apply -> preview -> validate 的顺序执行'
      }
    )
    runtime.assertThat(
      result.fileArtifacts.length >= 1 &&
        result.humanSteps.length === 6 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.toolResults.every((event) => !event.error),
      {
        name: 'human-docx-edit-artifacts',
        message: 'human 应产生可审阅预览 artifact 事件'
      }
    )
  }
})

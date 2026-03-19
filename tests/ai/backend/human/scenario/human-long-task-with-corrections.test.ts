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

const getToolOutputPreview = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): JsonObject | null => {
  const value = event.outputPreview
  if (!value || Array.isArray(value) || typeof value !== 'object') return null
  return value as JsonObject
}

defineAiHumanCase({
  caseId: 'human-long-task-with-corrections',
  caseType: 'scenario',
  groups: ['scenario'],
  description: '长任务中途加入新约束后，human 应修正已有草稿而不是让目标漂移。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-2.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-3.txt',
    'tests/fixtures/ai/workspace/materials/weekly/risk-summary.txt'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'correction-brief.docx', [
      { type: 'heading', text: 'Correction Brief', level: 1 },
      { type: 'paragraph', text: 'Summary: pending synthesis.' },
      { type: 'paragraph', text: 'Risk summary: pending synthesis.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '长任务先读取已有进展。',
              publicNarrative: '我先收集当前阶段进展。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '读取第一份基线材料。',
              publicNarrative: '我正在读取第 1 份进展材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-2.txt'
              },
              rationale: '读取第二份基线材料。',
              publicNarrative: '我正在读取第 2 份进展材料。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-3.txt'
              },
              rationale: '读取第三份基线材料。',
              publicNarrative: '我正在读取第 3 份进展材料。'
            }
          },
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '先根据已有基线起草初版摘要。',
              publicNarrative: '我先写出当前版本的初稿摘要。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'correction-brief.docx'
              },
              rationale: '打开待修正文档。',
              publicNarrative: '我正在打开 correction brief 模板。'
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
                    query: 'Summary: pending synthesis.',
                    replace: 'Summary: Ready for review after workspace, KB and docx baselines completed.'
                  }
                ]
              },
              rationale: '先基于当前进展起草一个乐观版本。',
              publicNarrative: '我正在先写入当前基线对应的初稿结论。'
            }
          },
          {
            output: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '中途补读风险约束，确认是否需要修正已有草稿。',
              publicNarrative: '我继续读取新增风险材料，检查是否要修正文案。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/weekly/risk-summary.txt'
              },
              rationale: '新约束来自风险汇总。',
              publicNarrative: '我正在读取风险汇总，确认是否需要调整结论。'
            }
          },
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '拿到新约束后回到文档修正已有草稿。',
              publicNarrative: '我回到文档里修正已有初稿，避免目标漂移。'
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
                    query: 'Summary: Ready for review after workspace, KB and docx baselines completed.',
                    replace:
                      'Summary: Do not sign off yet; approval denial coverage and terminal artifact assertion remain open.'
                  },
                  {
                    type: 'replace_text',
                    query: 'Risk summary: pending synthesis.',
                    replace:
                      'Risk summary: Approval branch requires explicit denial coverage. Terminal artifact recognition needs end-to-end assertion.'
                  }
                ]
              },
              rationale: '根据新约束把乐观初稿收敛成保守版本。',
              publicNarrative: '我正在基于新增风险约束修正既有草稿。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '生成修正后的可审阅版本。',
              publicNarrative: '我先生成修正后的预览。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '确认修正后结构仍稳定。',
              publicNarrative: '我正在校验修正后的文档结构。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '已在长任务中途纳入新约束，并修正 correction brief 交付。',
              rationale: '任务目标没有漂移，已有草稿已被收敛到新的风险约束。',
              publicNarrative: '我已经完成基于新约束的长任务纠偏。',
              resultData: {
                document_name: 'correction-brief.docx',
                artifact_role: 'preview',
                correction_source: 'risk-summary.txt'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `纠偏来源：${typeof resultData?.correction_source === 'string' ? resultData.correction_source : 'risk-summary.txt'}`,
            '说明：本轮先写入初稿，再根据新增风险约束回到原文做纠偏，不是重新起一个新方向。'
          ].join('\n')
      },
      { hardActionLimit: 16 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '先整理阶段基线，再补读风险汇总；如果中途发现新约束，要修正已有 brief，而不是重新做一份。'
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
      const correctedSummarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Do not sign off yet; approval denial coverage and terminal artifact assertion remain open.',
        mode: 'literal'
      })
      const optimisticSummarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Ready for review after workspace, KB and docx baselines completed.',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        correctedSummarySearch,
        optimisticSummarySearch,
        toolResults,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started')
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const riskPreview = result.toolResults
      .filter((event) => event.toolName === 'terminal_run_command')
      .map((event) => getToolOutputPreview(event))
      .filter((item): item is JsonObject => item !== null)
      .map((item) => String(item.outputPreview || ''))
      .find((text) => text.includes('Approval branch requires explicit denial coverage'))

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.correction_source === 'risk-summary.txt',
      {
        name: 'human-long-task-corrections-completed',
        message: '长任务纠偏场景应形成完成态交付'
      }
    )
    runtime.assertThat(
      Boolean(riskPreview) &&
        result.previewExists &&
        result.correctedSummarySearch.ok &&
        result.correctedSummarySearch.matches.length >= 1,
      {
        name: 'human-long-task-corrections-correction',
        message: '补读风险约束后，应把修正结论真实写入最终 preview'
      }
    )
    runtime.assertThat(
      result.optimisticSummarySearch.ok && result.optimisticSummarySearch.matches.length === 0,
      {
        name: 'human-long-task-corrections-no-drift',
        message: '最终 preview 不应残留被新约束推翻的乐观初稿'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 9)
        .map((event) => event.toolName)
        .join(',') ===
        [
          'terminal_run_command',
          'terminal_run_command',
          'terminal_run_command',
          'docx_open',
          'docx_apply_ops',
          'terminal_run_command',
          'docx_apply_ops',
          'docx_render_preview',
          'docx_validate'
        ].join(','),
      {
        name: 'human-long-task-corrections-order',
        message: '长任务纠偏应体现先起草、后补约束、再回写修正的顺序'
      }
    )
  }
})

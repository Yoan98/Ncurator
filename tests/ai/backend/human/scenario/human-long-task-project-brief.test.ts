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
  caseId: 'human-long-task-project-brief',
  caseType: 'scenario',
  groups: ['scenario'],
  description: 'human 在较高步数预算下完成多材料归并、风险补充与 docx brief 交付。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-2.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-3.txt',
    'tests/fixtures/ai/workspace/materials/weekly/risk-summary.txt'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'project-brief.docx', [
      { type: 'heading', text: 'Project Brief', level: 1 },
      { type: 'paragraph', text: 'Summary: pending synthesis.' },
      { type: 'paragraph', text: 'Risk summary: pending synthesis.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'workspace-shell',
              rationale: '长任务先做材料归并。',
              publicNarrative: '我先收集多份 workspace 材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-1.txt'
              },
              rationale: '读取 day 1 基线。',
              publicNarrative: '我正在读取第 1 份进展材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-2.txt'
              },
              rationale: '读取 day 2 基线。',
              publicNarrative: '我正在读取第 2 份进展材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/batch/day-3.txt'
              },
              rationale: '读取 day 3 基线。',
              publicNarrative: '我正在读取第 3 份进展材料。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'terminal_run_command',
              args: {
                command: 'cat ai/workspace/materials/weekly/risk-summary.txt'
              },
              rationale: '补齐风险约束。',
              publicNarrative: '我正在读取风险汇总材料。'
            }
          },
          {
            decision: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '材料齐全后转成 brief。',
              publicNarrative: '我现在把多份材料整理成 docx brief。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'project-brief.docx'
              },
              rationale: '先打开 brief 模板。',
              publicNarrative: '我正在打开项目 brief 模板。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_apply_ops',
              args: {
                ops: [
                  {
                    type: 'replace_text',
                    query: 'Summary: pending synthesis.',
                    replace:
                      'Summary: Completed workspace scan baseline, KB retrieval baseline, and docx review handoff baseline.'
                  },
                  {
                    type: 'replace_text',
                    query: 'Risk summary: pending synthesis.',
                    replace:
                      'Risk summary: Approval branch requires explicit denial coverage. Terminal artifact recognition needs end-to-end assertion.'
                  }
                ]
              },
              rationale: '把进展摘要和风险结论同时写入 brief。',
              publicNarrative: '我正在把汇总结论写入项目 brief。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '生成可审阅版本。',
              publicNarrative: '我先生成项目 brief 预览。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '长任务交付前确认结构有效。',
              publicNarrative: '我正在校验项目 brief 结构。'
            }
          },
          {
            decision: {
              action: 'complete_task',
              summary: '已完成多材料归并、风险补充，并交付 project brief 预览。',
              rationale: '长任务所需的材料读取、归并、写入与交付都已完成。',
              publicNarrative: '我已经完成长任务 brief 交付。',
              resultData: {
                document_name: 'project-brief.docx',
                artifact_role: 'preview',
                source_count: 4
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `来源材料数：${typeof resultData?.source_count === 'number' ? String(resultData.source_count) : '4'}`,
            `交付形式：${typeof resultData?.artifact_role === 'string' ? resultData.artifact_role : 'preview'}`
          ].join('\n')
      },
      { maxSteps: 12 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective:
          '请读取 batch/day-1.txt、day-2.txt、day-3.txt 和 weekly/risk-summary.txt，整理成 project-brief.docx 的可审阅 preview。'
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
      const baselineSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Completed workspace scan baseline, KB retrieval baseline, and docx review handoff baseline.',
        mode: 'literal'
      })
      const riskSearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'Approval branch requires explicit denial coverage.',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        baselineSearch,
        riskSearch,
        fileArtifacts,
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        terminalSteps: getEventsByType(runtime, 'terminal_step_started'),
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
        result.output.resultData?.source_count === 4,
      {
        name: 'human-long-task-project-brief-completed',
        message: '长任务 project brief 应形成完成态交付'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.baselineSearch.ok &&
        result.baselineSearch.matches.length >= 1 &&
        result.riskSearch.ok &&
        result.riskSearch.matches.length >= 1,
      {
        name: 'human-long-task-project-brief-preview',
        message: '长任务生成的 preview 应同时包含进展摘要与风险结论'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 8)
        .map((event) => event.toolName)
        .join(',') ===
        [
          'terminal_run_command',
          'terminal_run_command',
          'terminal_run_command',
          'terminal_run_command',
          'docx_open',
          'docx_apply_ops',
          'docx_render_preview',
          'docx_validate'
        ].join(','),
      {
        name: 'human-long-task-project-brief-order',
        message: '长任务应先做材料归并，再进入 docx 交付链路'
      }
    )
    runtime.assertThat(
      result.terminalSteps.length === 4 &&
        result.humanSteps.filter((event) => event.action === 'load_skill').length === 2 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-long-task-project-brief-events',
        message: '长任务应留下多次材料读取与 preview 交付证据'
      }
    )
  }
})

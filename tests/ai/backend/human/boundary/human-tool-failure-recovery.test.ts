import { releaseDocxRunSession } from '../../../../../src/main/services/ai/tools/docx/worker/docxWorkerClient'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

defineAiHumanCase({
  caseId: 'human-tool-failure-recovery',
  caseType: 'boundary',
  groups: ['boundary'],
  description: 'human 在首次工具失败后改走 outline + get_block 并继续完成任务。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/recovery.docx', [
      { type: 'heading', text: 'Incident Review', level: 1 },
      { type: 'paragraph', text: 'Primary status: mitigation is in progress.' },
      { type: 'paragraph', text: 'Fallback owner: Alice will verify the release checklist.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '需要读取 docx 里的具体段落。',
              publicNarrative: '我先加载文档读取能力。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'docs/recovery.docx'
              },
              rationale: '先打开文档。',
              publicNarrative: '我正在打开待检查的文档。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_search',
              args: {
                query: '(',
                mode: 'regex'
              },
              rationale: '先尝试直接搜索目标块。',
              publicNarrative: '我先直接搜索目标内容。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_outline',
              args: {
                maxBlocks: 20,
                includeTables: true,
                includeCells: true
              },
              rationale: '搜索失败后退回结构读取。',
              publicNarrative: '直接搜索失败后，我改用结构提取继续定位。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'docx_get_block',
              args: {
                blockId: 'b:2'
              },
              rationale: '已知目标段落位于第三个正文块，直接读取详情。',
              publicNarrative: '我正在读取目标块的详细内容。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '已通过 outline + get_block 找到 fallback owner：Alice。',
              rationale: '虽然首次搜索失败，但后续回退路径已经拿到明确证据。',
              publicNarrative: '我已经通过回退路径补齐证据，可以完成任务。',
              resultData: {
                fallback_owner: 'Alice',
                evidence_text: 'Fallback owner: Alice will verify the release checklist.'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ resultData, summary }) => {
          const owner =
            typeof resultData?.fallback_owner === 'string' ? resultData.fallback_owner : '未找到'
          return [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `回退结果：${owner}`
          ].join('\n')
        }
      },
      { hardActionLimit: 6 }
    )

    try {
      const output = await runner.run(
        {
          taskId: runtime.taskId,
          objective: '定位 recovery.docx 中 fallback owner 对应的段落，即使首次搜索失败也要继续完成。'
        }
    )

      return {
        output,
        humanSteps: getEventsByType(runtime, 'human_step'),
        toolResults: getEventsByType(runtime, 'tool_call_result')
      }
    } finally {
      await releaseDocxRunSession(runtime.runId)
    }
  },
  assert: async (result, runtime) => {
    const searchResult = result.toolResults.find((event) => event.toolName === 'docx_search')
    const getBlockResult = result.toolResults.find((event) => event.toolName === 'docx_get_block')

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.fallback_owner === 'Alice',
      {
        name: 'human-tool-recovery-completed',
        message: 'human 应在一次工具失败后仍完成任务'
      }
    )
    runtime.assertThat(
      Boolean(searchResult) &&
        String(searchResult?.error || '').includes('invalid regex pattern') &&
        Boolean(getBlockResult),
      {
        name: 'human-tool-recovery-switch',
        message: '首次搜索失败后，应继续走 outline + get_block 的回退链路'
      }
    )
    runtime.assertThat(
      result.humanSteps.some(
        (event) => event.toolName === 'docx_search' && event.resultStatus === 'error'
      ) &&
        result.humanSteps.some(
          (event) => event.toolName === 'docx_outline' && event.resultStatus === 'ok'
        ) &&
        result.humanSteps.some(
          (event) => event.toolName === 'docx_get_block' && event.resultStatus === 'ok'
        ),
      {
        name: 'human-tool-recovery-events',
        message: '事件流应记录失败后的换路和恢复完成'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('Alice') &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-tool-recovery-delivery',
        message: '最终交付应保留回退链路拿到的本地证据'
      }
    )
  }
})

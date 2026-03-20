import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanCase,
  getEventsByType,
  reasonActionBatch,
  reasonActivateCapability,
  reasonBlocked,
  reasonInvokeTool
} from '../helpers'

defineAiHumanCase({
  caseId: 'human-invalid-execution-batch',
  caseType: 'boundary',
  groups: ['boundary'],
  description: 'human 输出混合读写 batch 时，executor 应拒绝并回到 reason 收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'docs/batch-reject.docx', [
      { type: 'heading', text: 'Batch Reject', level: 1 },
      { type: 'paragraph', text: 'Summary: pending.' }
    ])

    const runner = createHumanTestRunner(runtime, {
      humanDeliveryOverride: ({ summary }) => ['# 子任务交付', '', `已完成：${summary}`].join('\n'),
      humanReasonOverrides: [
        {
          output: reasonActivateCapability({
            skillIds: ['docx-read', 'docx-write', 'docx-delivery'],
            rationale: '先激活 docx 能力。',
            publicNarrative: '我先加载文档编辑能力。'
          })
        },
        {
          output: reasonInvokeTool({
            toolName: 'docx_open',
            args: {
              sourcePath: 'docs/batch-reject.docx'
            },
            rationale: '先打开文档。',
            publicNarrative: '我正在打开待处理文档。'
          })
        },
        {
          output: reasonActionBatch({
            summary: '尝试并行读取并修改文档。',
            focusCurrent: 'docx-mixed-batch',
            actions: [
              {
                type: 'invoke_tool',
                toolName: 'docx_search',
                args: {
                  query: 'Summary',
                  mode: 'literal'
                },
                rationale: '读取摘要段。',
                publicNarrative: '我先查找摘要段。'
              },
              {
                type: 'invoke_tool',
                toolName: 'docx_apply_ops',
                args: {
                  ops: [
                    {
                      type: 'replace_text',
                      query: 'Summary: pending.',
                      replace: 'Summary: updated.'
                    }
                  ]
                },
                rationale: '同时写入更新内容。',
                publicNarrative: '我尝试同时修改摘要。'
              }
            ]
          })
        },
        {
          output: reasonBlocked({
            summary: '非法 batch 已被拒绝，当前计划需要回到串行执行后再继续。',
            rationale: 'executor 已明确拒绝混合读写 batch。'
          })
        }
      ]
    })

    const output = await runner.run({
      taskId: runtime.taskId,
      userInput: '验证混合读写的 batch plan 会被 executor 拒绝。'
    })

    return {
      output,
      humanSteps: getEventsByType(runtime, 'human_step'),
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      watchHints: getEventsByType(runtime, 'watch_hint')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'blocked',
      {
        name: 'human-invalid-batch-blocked',
        message: '非法混合 batch 应阻塞收敛'
      }
    )
    runtime.assertThat(
      result.toolCalls.length === 1 && result.toolCalls[0]?.toolName === 'docx_open',
      {
        name: 'human-invalid-batch-no-write',
        message: '非法 batch 不应继续执行后续读写工具'
      }
    )
    runtime.assertThat(
      result.watchHints.some(
        (event) => event.source === 'hand' && event.summary.includes('并行安全要求')
      ) &&
        result.humanSteps.some(
          (event) => event.action === 'block_result' && event.resultStatus === 'blocked'
        ),
      {
        name: 'human-invalid-batch-events',
        message: '事件流应记录非法 batch 被拒绝后的阻塞收敛'
      }
    )
  }
})

import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

defineAiHumanCase({
  caseId: 'human-evidence-insufficient-safe-stop',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '证据不足时，human 应明确说明缺口，并以安全方式收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        selectedDocumentIds: ['doc-missing'],
        documentsStoreOverrides: {
          hybridSearch: async () => []
        },
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'local-kb-retrieval',
              rationale: '先在本地知识库里查证。',
              publicNarrative: '我先检查当前本地资料是否足够。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'kb_hybrid_search_chunks',
              args: {
                queryText: 'final owner and timeline',
                limit: 3
              },
              rationale: '先尝试从本地资料里找到明确依据。',
              publicNarrative: '我正在检索本地知识库。'
            }
          },
          {
            decision: {
              action: 'complete_task',
              summary: '本地资料不足，暂时无法确认最终 owner 与 timeline。',
              rationale: '当前检索没有返回足够证据，应该安全收敛而不是编造答案。',
              publicNarrative: '我目前没有足够的本地证据，只能先给出缺口说明。',
              resultData: {
                gap_summary: '缺少能确认 final owner 与 timeline 的本地文档。',
                next_step: '请补充相关本地资料，或确认是否允许继续使用非本地信息。'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) =>
          [
            '# 最终答复',
            '',
            `当前状态：${summary}`,
            `缺口：${typeof resultData?.gap_summary === 'string' ? resultData.gap_summary : '未提供'}`,
            `下一步：${typeof resultData?.next_step === 'string' ? resultData.next_step : '请补充资料'}`,
            '说明：当前本地资料不足，是否允许继续使用非本地信息？'
          ].join('\n')
      },
      { maxSteps: 4 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '确认 final owner 与 timeline，如证据不足则安全收敛。'
      },
      {
        deliveryKind: 'final'
      }
    )

    return {
      output,
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      deliveries: getEventsByType(runtime, 'task_delivery_ready')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.localSourceStatus === 'insufficient',
      {
        name: 'human-safe-stop-status',
        message: '证据不足时，human 应以完成态安全收敛，并标记 localSourceStatus=insufficient'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('本地资料不足') &&
        result.output.deliveryMarkdown.includes('是否允许继续使用非本地信息') &&
        result.output.resultData?.gap_summary === '缺少能确认 final owner 与 timeline 的本地文档。',
      {
        name: 'human-safe-stop-gap',
        message: '安全收敛交付应明确缺口，并给出继续条件'
      }
    )
    runtime.assertThat(result.toolCalls.length === 1 && result.deliveries.length === 1, {
      name: 'human-safe-stop-no-hallucination-loop',
      message: '证据不足时不应进入无意义重复调用，应直接收敛'
    })
  }
})

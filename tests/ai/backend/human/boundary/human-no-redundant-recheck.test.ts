import type { SearchResult } from '../../../../../src/shared/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

defineAiHumanCase({
  caseId: 'human-no-redundant-recheck',
  caseType: 'boundary',
  groups: ['boundary'],
  description: '同一证据已足够时，human 不应再做重复确认。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let hybridCalls = 0

    const runner = createHumanTestRunner(
      runtime,
      {
        selectedDocumentIds: ['doc-policy'],
        documentsStoreOverrides: {
          hybridSearch: async () => {
            hybridCalls += 1
            const rows: SearchResult[] = [
              {
                id: 'chunk-policy-2',
                text: 'Approval branch requires explicit denial coverage.',
                document_id: 'doc-policy',
                document_name: 'release-policy.md',
                source_type: 'file',
                _score: 0.95
              }
            ]
            return rows
          }
        },
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillId: 'local-kb-retrieval',
              rationale: '先检索本地规范。',
              publicNarrative: '我先读取本地规范证据。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'kb_hybrid_search_chunks',
              args: {
                queryText: 'approval denial coverage requirement',
                limit: 3
              },
              rationale: '这一步已经足够拿到答案。',
              publicNarrative: '我正在检索本地知识库。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '本地规范已明确要求 approval denial coverage，无需再次确认。',
              rationale: '当前证据已经唯一且直接，不需要重复调用 KB 或 list_documents。',
              publicNarrative: '证据已经足够，我直接收敛到结论。',
              resultData: {
                document_name: 'release-policy.md',
                document_id: 'doc-policy',
                answer: 'Approval branch requires explicit denial coverage.'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ summary, resultData }) =>
          [
            '# 最终答复',
            '',
            `结论：${summary}`,
            `依据：${typeof resultData?.document_name === 'string' ? resultData.document_name : 'release-policy.md'}`
          ].join('\n')
      },
      { hardActionLimit: 4 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '确认 approval denial coverage 是否是发布规范要求，并避免重复确认。'
      }
    )

    return {
      output,
      hybridCalls,
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      humanSteps: getEventsByType(runtime, 'human_step')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.document_name === 'release-policy.md',
      {
        name: 'human-no-redundant-recheck-completed',
        message: '证据足够时，human 应直接完成任务'
      }
    )
    runtime.assertThat(
      result.hybridCalls === 1 &&
        result.toolCalls.length === 1 &&
        result.toolCalls[0]?.toolName === 'kb_hybrid_search_chunks',
      {
        name: 'human-no-redundant-recheck-once',
        message: '同一证据足够时，不应再重复调用 KB 做再次确认'
      }
    )
    runtime.assertThat(
      result.humanSteps.filter((event) => event.action === 'invoke_tool').length === 1 &&
        result.output.deliveryMarkdown.includes('无需再次确认'),
      {
        name: 'human-no-redundant-recheck-delivery',
        message: '最终交付应明确说明已基于现有证据收敛'
      }
    )
  }
})

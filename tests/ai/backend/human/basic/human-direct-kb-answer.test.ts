import type { JsonValue, SearchResult } from '../../../../../src/shared/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

const readString = (value: JsonValue | undefined, fallback: string): string => {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

defineAiHumanCase({
  caseId: 'human-direct-kb-answer',
  caseType: 'basic',
  groups: ['basic'],
  description: 'human 直接使用本地知识库检索并交付带依据的答案。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let observedQuery = ''
    let observedDocumentIds: string[] = []

    const runner = createHumanTestRunner(
      runtime,
      {
        selectedDocumentIds: ['doc-beta'],
        documentsStoreOverrides: {
          hybridSearch: async (_vector, queryText, _limit, _sourceType, documentIds) => {
            observedQuery = queryText
            observedDocumentIds = [...(documentIds || [])]
            const rows: SearchResult[] = [
              {
                id: 'chunk-beta-1',
                text: 'Approval flow still needs regression coverage before release.',
                document_id: 'doc-beta',
                document_name: 'release-checklist.md',
                source_type: 'file',
                _score: 0.91
              }
            ]
            return rows
          }
        },
        humanReasonOverrides: [
          {
            output: {
              action: 'load_skill',
              skillIds: ['kb-evidence-query'],
              rationale: '先加载本地知识检索能力。',
              publicNarrative: '我先读取本地知识库证据。'
            }
          },
          {
            output: {
              action: 'invoke_tool',
              toolName: 'kb_hybrid_search_chunks',
              args: {
                queryText: 'approval flow regression coverage',
                limit: 3
              },
              rationale: '先用 hybrid 检索直接找答案。',
              publicNarrative: '我正在检索本地知识库。'
            }
          },
          {
            output: {
              action: 'complete_task',
              summary: '发布前仍需补齐 approval flow 的 regression coverage。',
              rationale: '检索结果已经给出直接证据。',
              publicNarrative: '我已经拿到足够的本地证据，可以直接回答。'
            }
          }
        ],
        humanDeliveryOverride: ({ summary }) => {
          const answer = readString(summary, summary)
          return [
            '# 最终答复',
            '',
            `结论：${answer}`,
            '依据：release-checklist.md (doc-beta)'
          ].join('\n')
        }
      },
      { hardActionLimit: 4 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        userInput: '从本地知识库回答 approval flow regression coverage 是否已经完成。'
      }
    )

    return {
      output,
      observedQuery,
      observedDocumentIds,
      humanSteps: getEventsByType(runtime, 'human_step'),
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      deliveries: getEventsByType(runtime, 'task_delivery_ready')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.output.status === 'completed', {
      name: 'human-kb-answer-completed',
      message: 'human 应完成直接知识问答'
    })
    runtime.assertThat(
      result.observedQuery === 'approval flow regression coverage' &&
        JSON.stringify(result.observedDocumentIds) === JSON.stringify(['doc-beta']),
      {
        name: 'human-kb-answer-scope',
        message: 'human 应在当前 document scope 内执行 hybrid 检索'
      }
    )
    runtime.assertThat(
      result.output.deliveryMarkdown.includes('regression coverage') &&
        result.output.deliveryMarkdown.includes('release-checklist.md'),
      {
        name: 'human-kb-answer-citation',
        message: '最终交付应保留可回看的文档引用'
      }
    )
    runtime.assertThat(
      result.humanSteps.some((event) => event.action === 'learn_skill') &&
        result.humanSteps.some((event) => event.action === 'call_tool') &&
        result.humanSteps.some((event) => event.action === 'deliver_result') &&
        result.toolCalls.length === 1 &&
        result.toolCalls[0]?.toolName === 'kb_hybrid_search_chunks' &&
        result.deliveries.length === 1,
      {
        name: 'human-kb-answer-events',
        message: 'human 应留下完整且收敛的技能、工具和交付事件'
      }
    )
  }
})

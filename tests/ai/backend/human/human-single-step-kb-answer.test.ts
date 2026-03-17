import { describe, it } from 'vitest'
import type { AiRunEvent, HumanTaskOutput, SearchResult } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'

describe('human single step kb answer', () => {
  it('loads kb skill, retrieves local evidence, and completes a simple answer task', async () => {
    await runBackendCase({
      caseId: 'human-single-step-kb-answer',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 能完成单步 kb 问答闭环并形成正式交付',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(
          runtime,
          {
            selectedDocumentIds: ['doc-database'],
            humanDecisionOverrides: [
              {
                decision: {
                  action: 'load_skill',
                  skillId: 'local-kb-retrieval',
                  rationale: '需要先加载知识库检索能力。',
                  publicNarrative: '我先加载本地知识库能力。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'kb_hybrid_search_chunks',
                  args: {
                    queryText: 'LanceDB 分层设计',
                    limit: 3,
                    sourceType: 'file'
                  },
                  rationale: '先检索本地知识库中的数据库设计证据。',
                  publicNarrative: '我先查一下本地知识库中的相关资料。'
                }
              },
              {
                decision: {
                  action: 'complete_task',
                  summary: '知识库中已有 LanceDB 分层设计说明，可以给出结论。',
                  rationale: '证据已经足够形成回答。',
                  publicNarrative: '我已经拿到足够证据，可以整理答案。',
                  resultData: {
                    answer:
                      'LanceDB 分层设计把文档、chunk 与索引职责拆开，便于本地优先检索与后续扩展。'
                  }
                }
              }
            ],
            humanDeliveryOverride: (input) =>
              [
                '# 最终答复',
                '',
                '## 结论',
                String(input.resultData?.answer || ''),
                '',
                '## 依据',
                '资料来自本地知识库中的 database.md。'
              ].join('\n'),
            documentsStoreOverrides: {
              getDocumentById: async (id: string) =>
                id === 'doc-database'
                  ? {
                      id: 'doc-database',
                      name: 'database.md',
                      source_type: 'file',
                      file_path: '/workspace/database.md',
                      created_at: 1,
                      import_status: 2
                    }
                  : null,
              hybridSearch: async () =>
                [
                  {
                    id: 'chunk-1',
                    text: 'LanceDB 分层设计将 document、chunk 和索引职责拆分。',
                    document_name: 'database.md',
                    document_id: 'doc-database',
                    source_type: 'file',
                    metadata: { page: 1 },
                    created_at: 1
                  }
                ] satisfies SearchResult[]
            }
          },
          {
            maxSteps: 4
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective: '知识库里有没有关于 LanceDB 分层设计的说明？给我结论并引用依据。'
          },
          {
            deliveryKind: 'final',
            streamAnswer: false
          }
        )

        runtime.recordEvent({
          type: 'step',
          name: 'human-single-step-kb-answer',
          status: output.status === 'completed' ? 'ok' : 'failed',
          message:
            output.status === 'completed'
              ? 'human 单步 kb 问答闭环执行成功'
              : 'human 单步 kb 问答闭环执行失败',
          data: {
            status: output.status,
            resultCode: output.resultCode,
            summary: output.summary
          }
        })

        return {
          output,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.resultCode === 'ok' &&
            result.output.deliveryMarkdown.includes('LanceDB 分层设计') &&
            result.output.localSourceStatus === 'used',
          {
            name: 'human-kb-answer-completed',
            message: 'human 已完成 kb 问答并形成正式交付',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              localSourceStatus: result.output.localSourceStatus
            }
          }
        )
        runtime.assertThat(
          result.output.resultData?.document_name === 'database.md' &&
            result.output.resultData?.document_id === 'doc-database',
          {
            name: 'human-kb-answer-result-data-enriched',
            message: 'complete_task 的 resultData 已从检索结果补齐 document 信息',
            data: result.output.resultData
          }
        )

        const humanSteps = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'human_step'
        )
        const taskDelivery = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'task_delivery_ready'
        )
        const toolResults = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' && event.toolName === 'kb_hybrid_search_chunks'
        )

        runtime.assertThat(
          humanSteps.length === 3 && taskDelivery.length === 1 && toolResults.length === 1,
          {
            name: 'human-kb-answer-events-complete',
            message: 'load_skill / invoke_tool / complete_task 与 task_delivery_ready 事件已完整记录',
            data: {
              humanSteps: humanSteps.length,
              taskDelivery: taskDelivery.length,
              toolResults: toolResults.length
            }
          }
        )
      }
    })
  })
})

import { describe, it } from 'vitest'
import type { AiRunEvent, DocumentRecord, SearchResult } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'

const liveModelConfig = hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv() : null

const databaseDocument: DocumentRecord = {
  id: 'doc-database',
  name: 'database.md',
  source_type: 'file',
  file_path: '/workspace/database.md',
  created_at: 1,
  import_status: 2
}

const databaseSearchRows: SearchResult[] = [
  {
    id: 'chunk-1',
    text: 'LanceDB 分层设计将 document、chunk 和索引职责拆分。',
    document_name: 'database.md',
    document_id: 'doc-database',
    source_type: 'file',
    metadata: { page: 1 },
    created_at: 1
  }
]

const filterSearchRows = (
  rows: readonly SearchResult[],
  limit: number,
  sourceType?: string,
  documentIds?: string[]
): SearchResult[] => {
  return rows
    .filter((row) => {
      if (sourceType && row.source_type !== sourceType) return false
      if (documentIds && documentIds.length > 0 && !documentIds.includes(row.document_id)) {
        return false
      }
      return true
    })
    .slice(0, limit)
}

describe('human single step kb answer', () => {
  it('loads kb skill, retrieves local evidence, and completes a simple answer task', async () => {
    const isLiveMode = liveModelConfig !== null

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
      runtimeModelName: liveModelConfig?.model_name || null,
      execute: async (runtime) => {
        const runner = createHumanTestRunner(
          runtime,
          {
            selectedDocumentIds: ['doc-database'],
            liveModelConfig: liveModelConfig || undefined,
            humanDecisionOverrides: isLiveMode
              ? undefined
              : [
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
            humanDeliveryOverride: isLiveMode
              ? undefined
              : (input) =>
                  [
                    '# 最终答复',
                    '',
                    '## 结论',
                    String(input.resultData?.answer || input.summary || ''),
                    '',
                    '## 依据',
                    '资料来自本地知识库中的 database.md。'
                  ].join('\n'),
            documentsStoreOverrides: {
              getDocumentById: async (id: string) =>
                id === 'doc-database' ? databaseDocument : null,
              listDocuments: async () => ({
                items: [databaseDocument],
                total: 1
              }),
              hybridSearch: async (
                _queryVector: Float32Array,
                _queryText: string,
                limit: number,
                sourceType?: string,
                documentIds?: string[]
              ) => filterSearchRows(databaseSearchRows, limit, sourceType, documentIds),
              vectorSearch: async (
                _queryVector: Float32Array,
                limit: number,
                sourceType?: string,
                documentIds?: string[]
              ) => filterSearchRows(databaseSearchRows, limit, sourceType, documentIds),
              ftsSearch: async (
                _queryText: string,
                limit: number,
                sourceType?: string,
                documentIds?: string[]
              ) => filterSearchRows(databaseSearchRows, limit, sourceType, documentIds)
            }
          },
          {
            maxSteps: isLiveMode ? 16 : 4
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective:
              '只允许基于本地知识库回答，不要使用模型自带知识补全；如果本地证据不足就明确说明未找到。知识库里有没有关于 LanceDB 分层设计的说明？给我结论并引用依据。'
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
            (result.output.deliveryMarkdown.includes('LanceDB') ||
              result.output.summary.includes('LanceDB')) &&
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
          isLiveMode
            ? result.output.resultData === undefined ||
                (result.output.resultData.document_name === 'database.md' &&
                  result.output.resultData.document_id === 'doc-database')
            : result.output.resultData?.document_name === 'database.md' &&
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
        const retrievalToolResults = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' &&
            (
              event.toolName === 'kb_hybrid_search_chunks' ||
              event.toolName === 'kb_fts_search_chunks' ||
              event.toolName === 'kb_vector_search_chunks'
            )
        )

        runtime.assertThat(
          isLiveMode
            ? humanSteps.length >= 3 && taskDelivery.length === 1 && retrievalToolResults.length >= 1
            : humanSteps.length === 3 && taskDelivery.length === 1 && retrievalToolResults.length === 1,
          {
            name: 'human-kb-answer-events-complete',
            message: '检索取证、complete_task 与 task_delivery_ready 事件已完整记录',
            data: {
              humanSteps: humanSteps.length,
              taskDelivery: taskDelivery.length,
              retrievalToolResults: retrievalToolResults.length
            }
          }
        )
      }
    })
  })
})

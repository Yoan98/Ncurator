import { describe, it } from 'vitest'
import type { SearchResult } from '../../../../../src/shared/types'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'

type SearchCall = {
  queryText: string
  limit: number
  sourceType?: string
  documentIds?: string[]
}

const filterRows = (
  rows: readonly SearchResult[],
  sourceType: string | undefined,
  documentIds: string[] | undefined
): SearchResult[] => {
  return rows.filter((row) => {
    if (sourceType && row.source_type !== sourceType) return false
    if (documentIds && documentIds.length > 0 && row.document_id && !documentIds.includes(row.document_id)) {
      return false
    }
    if (documentIds && documentIds.length > 0 && !row.document_id) {
      return false
    }
    return true
  })
}

describe('kb search modes and scope', () => {
  it('covers hybrid/vector search plus scoped empty-result short-circuit behaviour', async () => {
    await runBackendCase({
      caseId: 'kb-search-modes-and-scope',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['kb'],
      description: '验证 kb capability 的 hybrid/vector 检索与 source scope 过滤行为',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const hybridCalls: SearchCall[] = []
        const vectorCalls: SearchCall[] = []
        const ftsCalls: SearchCall[] = []

        const rows: SearchResult[] = [
          {
            id: 'chunk-1',
            text: 'LanceDB uses layered local storage for fast recall.',
            document_name: 'database.md',
            document_id: 'doc-2',
            source_type: 'file',
            metadata: { page: 1 },
            created_at: 1
          },
          {
            id: 'chunk-2',
            text: 'Remote source guidance for hybrid retrieval.',
            document_name: 'web-source.md',
            document_id: 'doc-2',
            source_type: 'web',
            metadata: { page: 1 },
            created_at: 2
          }
        ]

        const documentsStoreOverrides = {
          hybridSearch: async (
            _queryVector: Float32Array,
            queryText: string,
            limit: number,
            sourceType?: string,
            documentIds?: string[]
          ) => {
            hybridCalls.push({ queryText, limit, sourceType, documentIds })
            return filterRows(rows, sourceType, documentIds).slice(0, limit)
          },
          vectorSearch: async (
            _queryVector: Float32Array,
            limit: number,
            sourceType?: string,
            documentIds?: string[]
          ) => {
            vectorCalls.push({
              queryText: 'vector-search',
              limit,
              sourceType,
              documentIds
            })
            return filterRows(rows, sourceType, documentIds).slice(0, limit)
          },
          ftsSearch: async (
            queryText: string,
            limit: number,
            sourceType?: string,
            documentIds?: string[]
          ) => {
            ftsCalls.push({ queryText, limit, sourceType, documentIds })
            return filterRows(rows, sourceType, documentIds).slice(0, limit)
          }
        }

        const scopedHarness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1', 'doc-2'],
          documentsStoreOverrides
        })

        const hybridResult = await scopedHarness.invoke<SearchResult[]>('kb_hybrid_search_chunks', {
          queryText: 'LanceDB layered storage',
          limit: 5,
          sourceType: 'file',
          documentIds: ['doc-2', 'doc-9']
        })
        const vectorResult = await scopedHarness.invoke<SearchResult[]>('kb_vector_search_chunks', {
          queryText: 'remote retrieval',
          limit: 5,
          sourceType: 'web',
          documentIds: ['doc-2']
        })

        const emptyScopeHarness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1'],
          documentsStoreOverrides
        })
        const ftsResult = await emptyScopeHarness.invoke<SearchResult[]>('kb_fts_search_chunks', {
          queryText: 'should short circuit',
          limit: 5,
          sourceType: 'file',
          documentIds: ['doc-9']
        })

        runtime.recordEvent({
          type: 'step',
          name: 'kb-search-modes-scope',
          status: 'ok',
          message: 'kb hybrid/vector/search scope 路径已经执行完成',
          data: {
            hybridCount: hybridResult.length,
            vectorCount: vectorResult.length,
            ftsCount: ftsResult.length
          }
        })

        return {
          hybridResult,
          vectorResult,
          ftsResult,
          hybridCalls,
          vectorCalls,
          ftsCalls,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.hybridResult.length === 1 &&
            result.hybridResult[0]?.document_id === 'doc-2' &&
            result.hybridCalls[0]?.documentIds?.join(',') === 'doc-2',
          {
            name: 'kb-hybrid-scope-filtered',
            message: 'hybrid search 只保留了 run scope 与请求 scope 的交集',
            data: {
              documentIds: result.hybridCalls[0]?.documentIds
            }
          }
        )
        runtime.assertThat(
          result.vectorResult.length === 1 && result.vectorResult[0]?.source_type === 'web',
          {
            name: 'kb-vector-source-filtered',
            message: 'vector search 正确按 sourceType=web 过滤结果'
          }
        )
        runtime.assertThat(result.ftsResult.length === 0 && result.ftsCalls.length === 0, {
          name: 'kb-empty-scope-short-circuit',
          message: '当请求 scope 与 run scope 交集为空时，fts search 直接返回空结果'
        })

        const toolResults = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_result'
        )
        runtime.assertThat(toolResults.length === 3, {
          name: 'kb-tool-results-recorded',
          message: '三次 kb 检索都记录了 tool_call_result 事件',
          data: {
            toolResults: toolResults.length
          }
        })
      }
    })
  })
})

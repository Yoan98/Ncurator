import { describe, it } from 'vitest'
import type { AiRunEvent, SearchResult } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'

describe('kb fts and no result', () => {
  it('covers positive fts retrieval and explicit empty results from the store layer', async () => {
    await runBackendCase({
      caseId: 'kb-fts-and-no-result',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['kb'],
      description: '验证 kb capability 的 FTS 正向检索与显式空结果返回',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ftsQueries: string[] = []
        const hybridQueries: string[] = []
        const harness = createRetrievalToolHarness(runtime, {
          documentsStoreOverrides: {
            ftsSearch: async (queryText: string, limit: number) => {
              ftsQueries.push(`${queryText}:${String(limit)}`)
              return [
                {
                  id: 'chunk-fts-1',
                  text: 'The database design uses layered LanceDB storage.',
                  document_name: 'database.md',
                  document_id: 'doc-db',
                  source_type: 'file',
                  metadata: { page: 2 },
                  created_at: 10
                }
              ]
            },
            hybridSearch: async (_queryVector: Float32Array, queryText: string) => {
              hybridQueries.push(queryText)
              return []
            }
          }
        })

        const ftsResult = await harness.invoke<SearchResult[]>('kb_fts_search_chunks', {
          queryText: 'LanceDB storage',
          limit: 3,
          sourceType: 'file'
        })
        const noResult = await harness.invoke<SearchResult[]>('kb_hybrid_search_chunks', {
          queryText: 'missing document',
          limit: 3,
          sourceType: 'file'
        })

        runtime.recordEvent({
          type: 'step',
          name: 'kb-fts-and-no-result',
          status: 'ok',
          message: 'kb FTS 正向检索与显式空结果路径已经执行',
          data: {
            ftsCount: ftsResult.length,
            hybridCount: noResult.length
          }
        })

        return {
          ftsResult,
          noResult,
          ftsQueries,
          hybridQueries,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.ftsResult.length === 1 &&
            result.ftsResult[0]?.document_id === 'doc-db' &&
            result.ftsQueries[0] === 'LanceDB storage:3',
          {
            name: 'kb-fts-positive-result',
            message: 'kb_fts_search_chunks 能返回正向命中结果',
            data: {
              query: result.ftsQueries[0]
            }
          }
        )
        runtime.assertThat(
          result.noResult.length === 0 && result.hybridQueries[0] === 'missing document',
          {
            name: 'kb-hybrid-explicit-empty-result',
            message: 'kb_hybrid_search_chunks 能如实返回 store 层的空结果'
          }
        )

        const toolResults = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_result'
        )
        runtime.assertThat(toolResults.length === 2, {
          name: 'kb-fts-no-result-events',
          message: 'FTS 与空结果 hybrid 调用都记录了 tool_call_result',
          data: {
            toolResults: toolResults.length
          }
        })
      }
    })
  })
})

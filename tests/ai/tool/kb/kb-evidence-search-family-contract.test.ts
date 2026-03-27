import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createTestSearchResult } from '../testHelpers'

type KbSearchRow = {
  id: string
  text: string
  document_id?: string
  document_name: string
  source_type?: string
  _score?: number
}

type SearchToolName =
  | 'kb_hybrid_search_chunks'
  | 'kb_vector_search_chunks'
  | 'kb_fts_search_chunks'

const filterRowsByScope = (
  rows: readonly KbSearchRow[],
  scopedDocumentIds?: string[]
): KbSearchRow[] => {
  if (!Array.isArray(scopedDocumentIds) || scopedDocumentIds.length === 0) {
    return [...rows]
  }

  const allowed = new Set(scopedDocumentIds)
  return rows.filter((row) => row.document_id && allowed.has(row.document_id))
}

describe('ai tool kb backend', () => {
  it('kb-evidence-search-family-contract', async () => {
    await runBackendCase({
      caseId: 'kb-evidence-search-family-contract',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description: '验证 kb_hybrid/vector/fts 三个检索工具的统一返回结构和范围约束。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const rows = [
          createTestSearchResult({
            id: 'chunk-1',
            text: 'Approval denied should keep existing files unchanged.',
            documentId: 'doc-1',
            documentName: 'AI Tool Guide.md'
          }),
          createTestSearchResult({
            id: 'chunk-2',
            text: 'Terminal artifacts must be declared and recorded.',
            documentId: 'doc-2',
            documentName: 'Release Checklist.md'
          }),
          createTestSearchResult({
            id: 'chunk-3',
            text: 'Out of scope notes should never be returned.',
            documentId: 'doc-3',
            documentName: 'Director Notes.md'
          })
        ]

        const executeScopedSearch = async (
          _queryText: string,
          _limit: number,
          _sourceType: string | undefined,
          scopedDocumentIds?: string[]
        ) => filterRowsByScope(rows, scopedDocumentIds)

        const harness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1', 'doc-2'],
          documentsStoreOverrides: {
            hybridSearch: async (_vec, queryText, limit, sourceType, scopedDocumentIds) =>
              await executeScopedSearch(queryText, limit, sourceType, scopedDocumentIds),
            vectorSearch: async (_vec, limit, sourceType, scopedDocumentIds) =>
              await executeScopedSearch('vector', limit, sourceType, scopedDocumentIds),
            ftsSearch: async (queryText, limit, sourceType, scopedDocumentIds) =>
              await executeScopedSearch(queryText, limit, sourceType, scopedDocumentIds)
          }
        })

        const invokeSearch = async (
          toolName: SearchToolName,
          args: { documentIds?: string[] }
        ) => await harness.invoke<KbSearchRow[]>(toolName, {
          queryText: 'approval denied',
          limit: 5,
          ...args
        })

        return {
          hybridInScope: await invokeSearch('kb_hybrid_search_chunks', {}),
          vectorSubset: await invokeSearch('kb_vector_search_chunks', {
            documentIds: ['doc-2', 'doc-3']
          }),
          ftsOutOfScope: await invokeSearch('kb_fts_search_chunks', {
            documentIds: ['doc-3']
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.hybridInScope.length === 2 &&
            result.hybridInScope.every(
              (row) =>
                (row.document_id === 'doc-1' || row.document_id === 'doc-2') &&
                typeof row.document_name === 'string' &&
                typeof row.text === 'string'
            ),
          {
            name: 'hybrid-search-returns-stable-rows',
            message: 'kb_hybrid_search_chunks 应返回稳定 rows 结构，并限制在当前资料范围内。',
            data: result.hybridInScope
          }
        )

        runtime.assertThat(
          result.vectorSubset.length === 1 && result.vectorSubset[0]?.document_id === 'doc-2',
          {
            name: 'vector-search-honors-explicit-document-scope',
            message: 'kb_vector_search_chunks 应继续遵守 documentIds 收窄后的范围。',
            data: result.vectorSubset
          }
        )

        runtime.assertThat(result.ftsOutOfScope.length === 0, {
          name: 'fts-search-rejects-out-of-scope-document-ids',
          message: 'kb_fts_search_chunks 在 requested documentIds 完全超出 run scope 时应返回空结果。',
          data: result.ftsOutOfScope
        })
      }
    })
  })
})

import { describe, test } from 'vitest'
import { buildRetrievalTools } from '../../../../src/main/services/ai/tools/local_kb_retrieval/retrievalTools'
import type { SearchResult } from '../../../../src/shared/types'
import { recordAssertion } from '../../harness/assertions'
import { runCapabilityCase } from '../../harness/capabilityCase'

type JsonRecord = Record<string, unknown>

const asSearchResultArray = (value: unknown): SearchResult[] => {
  if (!Array.isArray(value)) return []
  return value as SearchResult[]
}

const asSearchResponse = (value: unknown): { items: Array<{ id: string }>; total: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { items: [], total: 0 }
  }
  const row = value as JsonRecord
  const items = Array.isArray(row.items)
    ? row.items
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => item as { id: string })
    : []
  return {
    items,
    total: typeof row.total === 'number' ? row.total : items.length
  }
}

describe('capability/retrieval', () => {
  test('retrieval tools should intersect requested document ids with run scope', async () => {
    await runCapabilityCase({
      caseId: 'retrieval-scope-filter',
      description: '验证 local kb retrieval tools 只允许命中运行时 scope 内的 document ids。',
      expectedOutcome: 'success',
      scenarioTags: ['retrieval', 'scope-filter', 'local-kb'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'retrieval scope filter completed'
      }),
      execute: async (runtime) => {
        const hybridCalls: string[][] = []
        let listDocumentsCallCount = 0

        const ctx = {
          ...runtime.ctx,
          selectedDocumentIds: ['doc-a', 'doc-b'],
          documentsStore: {
            ...runtime.ctx.documentsStore,
            hybridSearch: async (
              _vector: Float32Array,
              _queryText: string,
              _limit?: number,
              _sourceType?: string,
              documentIds?: string[]
            ) => {
              hybridCalls.push(documentIds || [])
              return [
                {
                  id: 'chunk-1',
                  text: 'scoped result',
                  document_name: 'doc-b',
                  document_id: 'doc-b',
                  source_type: 'file',
                  metadata: { page: 1 },
                  created_at: Date.now()
                }
              ] satisfies SearchResult[]
            },
            listDocuments: async () => {
              listDocumentsCallCount += 1
              return {
                items: [
                  { id: 'doc-a' },
                  { id: 'doc-b' },
                  { id: 'doc-c' }
                ],
                total: 3
              }
            }
          }
        }

        const tools = buildRetrievalTools({
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId
        })

        const hybridTool = tools.find((item) => String(item.name) === 'kb_hybrid_search_chunks')
        const listDocsTool = tools.find((item) => String(item.name) === 'kb_list_documents')
        if (!hybridTool || !listDocsTool) {
          throw new Error('retrieval tools are missing')
        }

        const scopedHybrid = asSearchResultArray(
          await hybridTool.invoke({
            queryText: 'project scope',
            documentIds: ['doc-b', 'doc-c']
          })
        )
        const fullyOutOfScope = asSearchResultArray(
          await hybridTool.invoke({
            queryText: 'out of scope',
            documentIds: ['doc-c']
          })
        )
        const listDocs = asSearchResponse(
          await listDocsTool.invoke({
            keyword: 'doc',
            documentIds: ['doc-b', 'doc-c']
          })
        )
        const listDocsOutOfScope = asSearchResponse(
          await listDocsTool.invoke({
            keyword: 'doc',
            documentIds: ['doc-c']
          })
        )

        return {
          hybridCalls,
          listDocumentsCallCount,
          scopedHybrid,
          fullyOutOfScope,
          listDocs,
          listDocsOutOfScope
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'retrieval.intersects-run-scope-and-requested-ids',
          pass:
            result.hybridCalls.length >= 1 &&
            result.hybridCalls[0].length === 1 &&
            result.hybridCalls[0][0] === 'doc-b',
          details: JSON.stringify(result.hybridCalls)
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.short-circuits-when-requested-ids-are-fully-out-of-scope',
          pass:
            result.fullyOutOfScope.length === 0 &&
            result.hybridCalls.length === 1,
          details: JSON.stringify({
            hybridCalls: result.hybridCalls,
            fullyOutOfScope: result.fullyOutOfScope
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.list-documents-filters-to-intersection',
          pass:
            result.listDocs.items.length === 1 &&
            result.listDocs.items[0].id === 'doc-b' &&
            result.listDocs.total === 1,
          details: JSON.stringify(result.listDocs)
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.list-documents-skips-store-call-when-out-of-scope',
          pass:
            result.listDocsOutOfScope.items.length === 0 &&
            result.listDocsOutOfScope.total === 0 &&
            result.listDocumentsCallCount === 1,
          details: JSON.stringify({
            listDocumentsCallCount: result.listDocumentsCallCount,
            listDocsOutOfScope: result.listDocsOutOfScope
          })
        })
      }
    })
  })
})

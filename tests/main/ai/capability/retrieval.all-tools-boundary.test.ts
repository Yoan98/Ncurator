import { describe, test } from 'vitest'
import { buildRetrievalTools } from '../../../../src/main/services/ai/tools/local_kb_retrieval/retrievalTools'
import type { SearchResult } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

type RetrievalCall = {
  queryText: string
  limit: number
  sourceType: string
  documentIds: string[]
}
const CASE_METADATA = {
  description: '验证 retrieval 四类工具的 limit/page 边界、sourceType 透传与 scope 交集/短路行为。',
  expectedOutcome: 'success',
  scenarioTags: ['retrieval', 'all-tools', 'bounds', 'scope-filter'],
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'local-retrieval'
} as const

const asSearchResultArray = (value: JsonValue | undefined): SearchResult[] => {
  if (!Array.isArray(value)) return []
  return value as SearchResult[]
}

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asDocumentIds = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return []
  return value
}

describe('capability/retrieval', () => {
  test('retrieval tools should cover hybrid/vector/fts/list boundaries and strict scope behavior', async () => {
    await runCapabilityCase({
      caseId: 'retrieval-all-tools-boundary',
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'retrieval all-tools boundary completed'
      }),
      execute: async (runtime) => {
        const hybridCalls: RetrievalCall[] = []
        const vectorCalls: RetrievalCall[] = []
        const ftsCalls: RetrievalCall[] = []
        const listCalls: Array<{ keyword: string; page: number; pageSize: number }> = []

        const ctx = {
          ...runtime.ctx,
          selectedDocumentIds: ['doc-a', 'doc-b'],
          documentsStore: {
            ...runtime.ctx.documentsStore,
            hybridSearch: async (
              _vector: Float32Array,
              queryText: string,
              limit?: number,
              sourceType?: string,
              documentIds?: string[]
            ) => {
              hybridCalls.push({
                queryText,
                limit: Number(limit || 0),
                sourceType: String(sourceType || ''),
                documentIds: asDocumentIds(documentIds)
              })
              return [
                {
                  id: 'chunk-hybrid',
                  text: 'hybrid scoped result',
                  document_name: 'doc-a',
                  document_id: 'doc-a',
                  source_type: 'file',
                  metadata: { page: 1 },
                  created_at: Date.now()
                }
              ] satisfies SearchResult[]
            },
            vectorSearch: async (
              _vector: Float32Array,
              limit?: number,
              sourceType?: string,
              documentIds?: string[]
            ) => {
              vectorCalls.push({
                queryText: 'vector',
                limit: Number(limit || 0),
                sourceType: String(sourceType || ''),
                documentIds: asDocumentIds(documentIds)
              })
              return [
                {
                  id: 'chunk-vector',
                  text: 'vector scoped result',
                  document_name: 'doc-b',
                  document_id: 'doc-b',
                  source_type: 'web',
                  metadata: { page: 2 },
                  created_at: Date.now()
                }
              ] satisfies SearchResult[]
            },
            ftsSearch: async (
              queryText: string,
              limit?: number,
              sourceType?: string,
              documentIds?: string[]
            ) => {
              ftsCalls.push({
                queryText,
                limit: Number(limit || 0),
                sourceType: String(sourceType || ''),
                documentIds: asDocumentIds(documentIds)
              })
              return [
                {
                  id: 'chunk-fts',
                  text: 'fts scoped result',
                  document_name: 'doc-a',
                  document_id: 'doc-a',
                  source_type: 'file',
                  metadata: { page: 3 },
                  created_at: Date.now()
                }
              ] satisfies SearchResult[]
            },
            listDocuments: async ({ keyword, page, pageSize }) => {
              listCalls.push({
                keyword: String(keyword || ''),
                page: Number(page || 0),
                pageSize: Number(pageSize || 0)
              })
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
        const vectorTool = tools.find((item) => String(item.name) === 'kb_vector_search_chunks')
        const ftsTool = tools.find((item) => String(item.name) === 'kb_fts_search_chunks')
        const listTool = tools.find((item) => String(item.name) === 'kb_list_documents')

        if (!hybridTool || !vectorTool || !ftsTool || !listTool) {
          throw new Error('retrieval tools are missing')
        }

        const hybridResult = asSearchResultArray(
          (await hybridTool.invoke({
            queryText: 'hybrid query',
            limit: 999,
            sourceType: 'file'
          })) as JsonValue
        )

        const vectorResult = asSearchResultArray(
          (await vectorTool.invoke({
            queryText: 'vector query',
            limit: -3,
            sourceType: 'web',
            documentIds: ['doc-b', 'doc-c']
          })) as JsonValue
        )

        const ftsResult = asSearchResultArray(
          (await ftsTool.invoke({
            queryText: 'fts query',
            limit: 0,
            sourceType: 'all'
          })) as JsonValue
        )

        const ftsOutOfScopeResult = asSearchResultArray(
          (await ftsTool.invoke({
            queryText: 'fts out-of-scope',
            documentIds: ['doc-x']
          })) as JsonValue
        )

        const listResult = asRecord(
          (await listTool.invoke({
            keyword: 'doc',
            page: 0,
            pageSize: 999,
            documentIds: ['doc-b', 'doc-c']
          })) as JsonValue
        )

        const listOutOfScopeResult = asRecord(
          (await listTool.invoke({
            keyword: 'doc',
            page: 1,
            pageSize: 20,
            documentIds: ['doc-x']
          })) as JsonValue
        )

        return {
          hybridCalls,
          vectorCalls,
          ftsCalls,
          listCalls,
          hybridResult,
          vectorResult,
          ftsResult,
          ftsOutOfScopeResult,
          listResult,
          listOutOfScopeResult
        }
      },
      assert: async (result, runtime) => {
        const listItems = Array.isArray(result.listResult.items) ? result.listResult.items : []
        const listOutItems = Array.isArray(result.listOutOfScopeResult.items)
          ? result.listOutOfScopeResult.items
          : []

        recordAssertion(runtime.assertions, {
          id: 'retrieval.hybrid.limit-clamped-and-scope-applied',
          pass:
            result.hybridCalls.length === 1 &&
            result.hybridCalls[0].limit === 50 &&
            result.hybridCalls[0].sourceType === 'file' &&
            result.hybridCalls[0].documentIds.join(',') === 'doc-a,doc-b' &&
            result.hybridResult.length > 0,
          details: JSON.stringify(result.hybridCalls)
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.vector.limit-min-and-scope-intersection',
          pass:
            result.vectorCalls.length === 1 &&
            result.vectorCalls[0].limit === 1 &&
            result.vectorCalls[0].sourceType === 'web' &&
            result.vectorCalls[0].documentIds.join(',') === 'doc-b' &&
            result.vectorResult.length > 0,
          details: JSON.stringify(result.vectorCalls)
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.fts.all-source-and-run-scope-default',
          pass:
            result.ftsCalls.length === 1 &&
            result.ftsCalls[0].limit === 1 &&
            result.ftsCalls[0].sourceType === '' &&
            result.ftsCalls[0].documentIds.join(',') === 'doc-a,doc-b' &&
            result.ftsResult.length > 0,
          details: JSON.stringify(result.ftsCalls)
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.fts.out-of-scope-short-circuit',
          pass: result.ftsOutOfScopeResult.length === 0 && result.ftsCalls.length === 1,
          details: JSON.stringify({
            ftsCalls: result.ftsCalls,
            ftsOutOfScopeCount: result.ftsOutOfScopeResult.length
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.list.page-size-clamped-and-filtered',
          pass:
            result.listCalls.length === 1 &&
            result.listCalls[0].page === 1 &&
            result.listCalls[0].pageSize === 50 &&
            listItems.length === 1 &&
            String(asRecord(listItems[0] as JsonValue).id) === 'doc-b' &&
            Number(result.listResult.total || 0) === 1,
          details: JSON.stringify({ listCalls: result.listCalls, listResult: result.listResult })
        })
        recordAssertion(runtime.assertions, {
          id: 'retrieval.list.out-of-scope-short-circuit',
          pass:
            listOutItems.length === 0 &&
            Number(result.listOutOfScopeResult.total || 0) === 0 &&
            result.listCalls.length === 1,
          details: JSON.stringify({
            listCalls: result.listCalls,
            listOutOfScopeResult: result.listOutOfScopeResult
          })
        })
      }
    })
  })
})

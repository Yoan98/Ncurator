import { test } from 'vitest'
import type {
  AiRunEvent,
  DocumentListResponse,
  DocumentRecord,
  SearchResult
} from '../../../../../src/shared/types'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

const buildDocument = (id: string, name: string): DocumentRecord => ({
  id,
  name,
  source_type: 'file',
  created_at: 1,
  import_status: 2
})

test('kb-shared-search', async () => {
  await runBackendCase({
    caseId: 'kb-shared-search',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['kb'],
    description: 'kb retrieval tools share common search flow, preserve scope filtering, and normalize previews.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const hybridCalls: Array<{ queryText: string; documentIds?: string[]; limit: number }> = []
      const vectorCalls: Array<{ queryText: string; documentIds?: string[]; limit: number }> = []
      const ftsCalls: Array<{ queryText: string; documentIds?: string[]; limit: number }> = []

      const harness = createRetrievalToolHarness(runtime, {
        selectedDocumentIds: ['doc-1'],
        documentsStoreOverrides: {
          hybridSearch: async (_vector, queryText, limit, _filter, documentIds) => {
            hybridCalls.push({ queryText, limit, documentIds })
            return [
              {
                id: 'chunk-1',
                text: 'risk evidence',
                document_name: 'Doc One',
                document_id: 'doc-1',
                source_type: 'file',
                metadata: { page: 1 },
                created_at: 1
              }
            ]
          },
          vectorSearch: async (_vector, limit, _filter, documentIds) => {
            vectorCalls.push({ queryText: 'vector', limit, documentIds })
            return [
              {
                id: 'chunk-2',
                text: 'vector evidence',
                document_name: 'Doc Two',
                document_id: 'doc-2',
                source_type: 'file',
                metadata: { page: 2 },
                created_at: 2
              }
            ]
          },
          ftsSearch: async (queryText, limit, _filter, documentIds) => {
            ftsCalls.push({ queryText, limit, documentIds })
            return [
              {
                id: 'chunk-3',
                text: 'keyword evidence',
                document_name: 'Doc One',
                document_id: 'doc-1',
                source_type: 'file',
                metadata: { page: 3 },
                created_at: 3
              }
            ]
          },
          listDocuments: async () => ({
            items: [buildDocument('doc-1', 'Doc One'), buildDocument('doc-2', 'Doc Two')],
            total: 2
          })
        }
      })

      const hybridResult = await harness.invoke<SearchResult[]>('kb_hybrid_search_chunks', {
        queryText: 'risk',
        documentIds: ['doc-1', 'doc-2'],
        limit: 99
      })
      const vectorResult = await harness.invoke<SearchResult[]>('kb_vector_search_chunks', {
        queryText: 'vector-only',
        documentIds: ['doc-2']
      })
      const ftsResult = await harness.invoke<SearchResult[]>('kb_fts_search_chunks', {
        queryText: 'keyword',
        limit: 5
      })
      const listResult = await harness.invoke<DocumentListResponse>('kb_list_documents', {
        page: 1,
        pageSize: 20,
        documentIds: ['doc-1', 'doc-2']
      })

      return {
        hybridResult,
        vectorResult,
        ftsResult,
        listResult,
        hybridCalls,
        vectorCalls,
        ftsCalls,
        events: runtime.eventCollector.snapshot()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.hybridCalls.length === 1, {
        name: 'kb-hybrid-called',
        message: 'hybrid search should execute once when scoped ids remain after intersection',
        data: result.hybridCalls
      })

      runtime.assertThat(result.hybridCalls[0]?.documentIds?.join(',') === 'doc-1', {
        name: 'kb-hybrid-scope',
        message: 'hybrid search should receive the intersected scoped document ids',
        data: result.hybridCalls[0]
      })

      runtime.assertThat(result.vectorCalls.length === 0 && result.vectorResult.length === 0, {
        name: 'kb-empty-scope-short-circuit',
        message: 'vector search should short-circuit when requested document ids are outside run scope',
        data: {
          vectorCalls: result.vectorCalls,
          vectorResult: result.vectorResult
        }
      })

      runtime.assertThat(result.ftsCalls[0]?.documentIds?.join(',') === 'doc-1', {
        name: 'kb-default-run-scope',
        message: 'fts search should inherit run-scoped document ids when no explicit ids are provided',
        data: result.ftsCalls[0]
      })

      runtime.assertThat(typeof result.hybridResult[0]?.metadata === 'string', {
        name: 'kb-ipc-normalization',
        message: 'kb search results should normalize object metadata into IPC-safe strings',
        data: result.hybridResult[0]
      })

      runtime.assertThat(
        result.listResult.items.length === 1 && result.listResult.items[0]?.id === 'doc-1',
        {
          name: 'kb-list-filtered',
          message: 'kb_list_documents should filter listed documents by the resolved run scope',
          data: result.listResult
        }
      )

      const started = result.events.filter((event) => isEventType(event, 'tool_call_started'))
      const completed = result.events.filter((event) => isEventType(event, 'tool_call_result'))
      runtime.assertThat(started.length === 4 && completed.length === 4, {
        name: 'kb-tool-events',
        message: 'all kb tools in this regression should emit started/result tool events',
        data: {
          started,
          completed
        }
      })
    }
  })
})

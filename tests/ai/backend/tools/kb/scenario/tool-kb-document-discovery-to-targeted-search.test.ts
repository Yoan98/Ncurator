import { createRetrievalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import {
  createDocumentRecord,
  createSearchResult,
  defineAiToolCase,
  getEventsByType
} from '../../helpers'

defineAiToolCase({
  caseId: 'tool-kb-document-discovery-to-targeted-search',
  caseType: 'scenario',
  groups: ['kb', 'scenario'],
  description: '先发现候选文档，再把缩小后的范围传给 hybrid / fts 做证据收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let listObserved: {
      keyword?: string
      page: number
      pageSize: number
    } | null = null
    let hybridObserved: {
      queryText: string
      limit: number
      sourceType?: string
      documentIds?: string[]
    } | null = null
    let ftsObserved: {
      queryText: string
      limit: number
      sourceType?: string
      documentIds?: string[]
    } | null = null

    const harness = createRetrievalToolHarness(runtime, {
      selectedDocumentIds: ['doc-guideline', 'doc-checklist', 'doc-runbook'],
      documentsStoreOverrides: {
        listDocuments: async ({ keyword, page, pageSize }) => {
          listObserved = {
            keyword,
            page,
            pageSize
          }
          return {
            items: [
              createDocumentRecord({ id: 'doc-guideline', name: 'release-guideline.md' }),
              createDocumentRecord({ id: 'doc-checklist', name: 'release-checklist.md' }),
              createDocumentRecord({ id: 'doc-outside', name: 'release-retro.md' })
            ],
            total: 3
          }
        },
        hybridSearch: async (_vector, queryText, limit, sourceType, documentIds) => {
          hybridObserved = {
            queryText,
            limit,
            sourceType,
            documentIds
          }
          if (JSON.stringify(documentIds || []) !== JSON.stringify(['doc-guideline'])) {
            return []
          }
          return [
            createSearchResult({
              id: 'chunk-guideline-1',
              text: 'Release guideline says to preview the document before any final save.',
              documentId: 'doc-guideline',
              documentName: 'release-guideline.md',
              score: 0.95
            })
          ]
        },
        ftsSearch: async (queryText, limit, sourceType, documentIds) => {
          ftsObserved = {
            queryText,
            limit,
            sourceType,
            documentIds
          }
          if (JSON.stringify(documentIds || []) !== JSON.stringify(['doc-guideline'])) {
            return []
          }
          return [
            createSearchResult({
              id: 'chunk-guideline-2',
              text: 'Preview first before save, then attach the generated diff summary.',
              documentId: 'doc-guideline',
              documentName: 'release-guideline.md',
              score: 0.99
            })
          ]
        }
      }
    })

    const listed = await harness.invoke<{
      items: Array<{ id: string; name: string }>
      total: number
    }>('kb_list_documents', {
      keyword: 'release',
      page: 1,
      pageSize: 10,
      documentIds: ['doc-guideline', 'doc-checklist', 'doc-outside']
    })

    const targetDocumentIds = listed.items
      .filter((item) => item.name.includes('guideline'))
      .map((item) => item.id)

    const hybrid = await harness.invoke<
      Array<{ id: string; text: string; document_id?: string; document_name: string }>
    >('kb_hybrid_search_chunks', {
      queryText: 'preview before save',
      limit: 3,
      sourceType: 'file',
      documentIds: targetDocumentIds
    })

    const exact = await harness.invoke<
      Array<{ id: string; text: string; document_id?: string; document_name: string }>
    >('kb_fts_search_chunks', {
      queryText: 'Preview first before save',
      limit: 2,
      sourceType: 'file',
      documentIds: targetDocumentIds
    })

    const started = getEventsByType(runtime, 'tool_call_started').map((event) => event.toolName)
    const completed = getEventsByType(runtime, 'tool_call_result').map((event) => event.toolName)

    return {
      listed,
      targetDocumentIds,
      hybrid,
      exact,
      listObserved,
      hybridObserved,
      ftsObserved,
      started,
      completed
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      Boolean(result.listObserved) &&
        result.listObserved?.keyword === 'release' &&
        result.listObserved?.page === 1 &&
        result.listObserved?.pageSize === 10 &&
        result.listed.total === 2 &&
        JSON.stringify(result.listed.items.map((item) => item.id)) ===
          JSON.stringify(['doc-guideline', 'doc-checklist']),
      {
        name: 'kb-scenario-document-discovery',
        message: 'list_documents 应先收敛到运行范围与请求范围交集内的候选文档'
      }
    )
    runtime.assertThat(
      JSON.stringify(result.targetDocumentIds) === JSON.stringify(['doc-guideline']) &&
        result.hybrid.length === 1 &&
        result.hybrid[0].document_id === 'doc-guideline' &&
        Boolean(result.hybridObserved) &&
        result.hybridObserved?.queryText === 'preview before save' &&
        JSON.stringify(result.hybridObserved?.documentIds || []) ===
          JSON.stringify(['doc-guideline']),
      {
        name: 'kb-scenario-targeted-hybrid-search',
        message: 'hybrid 检索应只在缩小后的目标文档范围内返回语义命中'
      }
    )
    runtime.assertThat(
      result.exact.length === 1 &&
        result.exact[0].document_name === 'release-guideline.md' &&
        result.exact[0].text.includes('Preview first before save') &&
        Boolean(result.ftsObserved) &&
        result.ftsObserved?.queryText === 'Preview first before save' &&
        JSON.stringify(result.ftsObserved?.documentIds || []) ===
          JSON.stringify(['doc-guideline']),
      {
        name: 'kb-scenario-exact-confirmation',
        message: 'FTS 检索应在同一目标文档内补出可直接引用的精确证据'
      }
    )
    runtime.assertThat(
      JSON.stringify(result.started) ===
        JSON.stringify(['kb_list_documents', 'kb_hybrid_search_chunks', 'kb_fts_search_chunks']) &&
        JSON.stringify(result.completed) ===
          JSON.stringify(['kb_list_documents', 'kb_hybrid_search_chunks', 'kb_fts_search_chunks']),
      {
        name: 'kb-scenario-tool-chain',
        message: 'scenario 应记录完整的多步检索链路，而不是退化成单次工具调用'
      }
    )
  }
})

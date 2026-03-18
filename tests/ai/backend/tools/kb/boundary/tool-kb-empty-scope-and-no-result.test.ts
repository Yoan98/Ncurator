import { createRetrievalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-kb-empty-scope-and-no-result',
  caseType: 'boundary',
  groups: ['kb', 'boundary'],
  description: '覆盖空 scope 时的短路返回，以及合法 scope 下无结果时的空数组收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let hybridCalls = 0
    let listCalls = 0
    let ftsCalls = 0

    const harness = createRetrievalToolHarness(runtime, {
      selectedDocumentIds: ['doc-allowed'],
      documentsStoreOverrides: {
        hybridSearch: async () => {
          hybridCalls += 1
          return []
        },
        listDocuments: async () => {
          listCalls += 1
          return {
            items: [],
            total: 0
          }
        },
        ftsSearch: async () => {
          ftsCalls += 1
          return []
        }
      }
    })

    const emptyScopeSearch = await harness.invoke<Array<{ id: string }>>('kb_hybrid_search_chunks', {
      queryText: 'missing',
      documentIds: ['doc-missing']
    })
    const emptyScopeList = await harness.invoke<{
      items: Array<{ id: string }>
      total: number
    }>('kb_list_documents', {
      documentIds: ['doc-missing']
    })
    const noResultSearch = await harness.invoke<Array<{ id: string }>>('kb_fts_search_chunks', {
      queryText: 'still-missing'
    })

    return {
      emptyScopeSearch,
      emptyScopeList,
      noResultSearch,
      hybridCalls,
      listCalls,
      ftsCalls
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.emptyScopeSearch.length === 0 && result.hybridCalls === 0,
      {
        name: 'kb-empty-scope-search-short-circuit',
        message: '当请求范围与运行范围无交集时，hybrid 检索应直接返回空数组且不触发底层查询'
      }
    )
    runtime.assertThat(
      result.emptyScopeList.total === 0 && result.emptyScopeList.items.length === 0 && result.listCalls === 0,
      {
        name: 'kb-empty-scope-list-short-circuit',
        message: '当 document scope 为空时，list_documents 也应直接返回空结果'
      }
    )
    runtime.assertThat(result.noResultSearch.length === 0 && result.ftsCalls === 1, {
      name: 'kb-no-result-safe-empty',
      message: '合法 scope 下无结果时，FTS 检索应安全返回空数组'
    })
  }
})

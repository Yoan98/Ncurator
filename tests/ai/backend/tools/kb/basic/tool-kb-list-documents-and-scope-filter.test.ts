import { createRetrievalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, createDocumentRecord } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-kb-list-documents-and-scope-filter',
  caseType: 'basic',
  groups: ['kb', 'basic'],
  description: '先列出文档，再验证 documentIds scope 交集只保留允许的文档。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let observed: {
      keyword?: string
      page: number
      pageSize: number
    } | null = null

    const harness = createRetrievalToolHarness(runtime, {
      selectedDocumentIds: ['doc-1', 'doc-2'],
      documentsStoreOverrides: {
        listDocuments: async ({ keyword, page, pageSize }) => {
          observed = {
            keyword,
            page,
            pageSize
          }
          return {
            items: [
              createDocumentRecord({ id: 'doc-1', name: 'weekly-report.md' }),
              createDocumentRecord({ id: 'doc-2', name: 'release-plan.md' }),
              createDocumentRecord({ id: 'doc-3', name: 'approval-log.md' })
            ],
            total: 3
          }
        }
      }
    })

    const result = await harness.invoke<{
      items: Array<{ id: string; name: string }>
      total: number
    }>('kb_list_documents', {
      keyword: 'plan',
      page: 1,
      pageSize: 10,
      documentIds: ['doc-2', 'doc-3']
    })

    return {
      result,
      observed
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      Boolean(result.observed) &&
        result.observed?.keyword === 'plan' &&
        result.observed?.page === 1 &&
        result.observed?.pageSize === 10,
      {
        name: 'kb-list-params',
        message: '文档枚举应正确透传分页与 keyword 参数'
      }
    )
    runtime.assertThat(
      result.result.total === 1 &&
        result.result.items.length === 1 &&
        result.result.items[0].id === 'doc-2',
      {
        name: 'kb-list-scope-filter',
        message: 'list_documents 结果应只保留运行范围与请求范围交集内的文档'
      }
    )
  }
})

import { describe, it } from 'vitest'
import type { AiRunEvent, DocumentRecord } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'

type ListDocumentsResult = {
  items: DocumentRecord[]
  total: number
}

type ListCall = {
  keyword?: string
  page: number
  pageSize: number
}

describe('kb list documents', () => {
  it('filters listed documents by selected scope and short-circuits when scope is empty', async () => {
    await runBackendCase({
      caseId: 'kb-list-documents',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['kb'],
      description: '验证 kb_list_documents 的 scope 过滤、分页参数透传与空交集短路',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const listCalls: ListCall[] = []
        const documents: DocumentRecord[] = [
          {
            id: 'doc-1',
            name: 'weekly-report-template.docx',
            source_type: 'file',
            file_path: '/workspace/weekly-report-template.docx',
            created_at: 1,
            import_status: 2
          },
          {
            id: 'doc-2',
            name: 'database-guidelines.md',
            source_type: 'file',
            file_path: '/workspace/database-guidelines.md',
            created_at: 2,
            import_status: 2
          },
          {
            id: 'doc-3',
            name: 'weekly-report-review.md',
            source_type: 'web',
            created_at: 3,
            import_status: 2
          }
        ]

        const documentsStoreOverrides = {
          listDocuments: async (params: ListCall) => {
            listCalls.push(params)
            return {
              items: documents,
              total: documents.length
            }
          }
        }

        const scopedHarness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1', 'doc-3'],
          documentsStoreOverrides
        })
        const scopedResult = await scopedHarness.invoke<ListDocumentsResult>('kb_list_documents', {
          keyword: 'weekly-report',
          page: 1,
          pageSize: 20
        })

        const emptyScopeHarness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1'],
          documentsStoreOverrides
        })
        const emptyResult = await emptyScopeHarness.invoke<ListDocumentsResult>('kb_list_documents', {
          page: 1,
          pageSize: 20,
          documentIds: ['doc-9']
        })

        runtime.recordEvent({
          type: 'step',
          name: 'kb-list-documents-scope',
          status: 'ok',
          message: 'kb_list_documents 的过滤与空 scope 路径已经执行完成',
          data: {
            scopedTotal: scopedResult.total,
            emptyTotal: emptyResult.total,
            listCallCount: listCalls.length
          }
        })

        return {
          scopedResult,
          emptyResult,
          listCalls,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.scopedResult.total === 2 &&
            result.scopedResult.items.map((item) => item.id).join(',') === 'doc-1,doc-3',
          {
            name: 'kb-list-documents-scope-filter',
            message: 'kb_list_documents 只返回当前 scope 内的文档',
            data: {
              ids: result.scopedResult.items.map((item) => item.id)
            }
          }
        )
        runtime.assertThat(
          result.listCalls.length === 1 &&
            result.listCalls[0]?.keyword === 'weekly-report' &&
            result.listCalls[0]?.pageSize === 20,
          {
            name: 'kb-list-documents-pagination-passed-through',
            message: 'kb_list_documents 将分页和 keyword 参数透传给 store'
          }
        )
        runtime.assertThat(result.emptyResult.total === 0 && result.emptyResult.items.length === 0, {
          name: 'kb-list-documents-empty-scope',
          message: '当文档 scope 交集为空时，kb_list_documents 直接返回空结果'
        })

        const toolResults = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_result'
        )
        runtime.assertThat(toolResults.length === 2, {
          name: 'kb-list-documents-events',
          message: '两次 kb_list_documents 调用都记录了 tool_call_result 事件',
          data: {
            toolResults: toolResults.length
          }
        })
      }
    })
  })
})

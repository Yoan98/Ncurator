import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createTestDocumentRecord } from '../testHelpers'

type KbListDocumentsResult = {
  items: Array<{
    id: string
    name: string
    source_type: 'file' | 'web'
  }>
  total: number
}

describe('ai tool kb backend', () => {
  it('kb-document-discovery-contract', async () => {
    await runBackendCase({
      caseId: 'kb-document-discovery-contract',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description: '验证 kb_list_documents 的列表、过滤和资料范围收敛契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const documents = [
          createTestDocumentRecord({
            id: 'doc-1',
            name: 'AI Tool Guide.md'
          }),
          createTestDocumentRecord({
            id: 'doc-2',
            name: 'Release Checklist.md'
          }),
          createTestDocumentRecord({
            id: 'doc-3',
            name: 'Director Notes.md'
          })
        ]

        const harness = createRetrievalToolHarness(runtime, {
          selectedDocumentIds: ['doc-1', 'doc-2'],
          documentsStoreOverrides: {
            listDocuments: async ({ keyword }) => {
              const normalizedKeyword = String(keyword || '').trim().toLowerCase()
              const items = normalizedKeyword
                ? documents.filter((document) =>
                    document.name.toLowerCase().includes(normalizedKeyword)
                  )
                : documents
              return {
                items,
                total: items.length
              }
            }
          }
        })

        return {
          allInScope: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {}),
          keywordFiltered: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            keyword: 'Guide'
          }),
          requestedSubset: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            documentIds: ['doc-2', 'doc-3']
          }),
          emptySubset: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            documentIds: ['doc-3']
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.allInScope.total === 2 &&
            result.allInScope.items.map((item) => item.id).join(',') === 'doc-1,doc-2',
          {
            name: 'list-documents-honors-run-scope',
            message: 'kb_list_documents 应只返回当前 selectedDocumentIds 范围内的文档。',
            data: {
              ids: result.allInScope.items.map((item) => item.id),
              total: result.allInScope.total
            }
          }
        )

        runtime.assertThat(
          result.keywordFiltered.total === 1 &&
            result.keywordFiltered.items[0]?.id === 'doc-1' &&
            result.keywordFiltered.items[0]?.name === 'AI Tool Guide.md',
          {
            name: 'list-documents-supports-keyword-filter',
            message: 'kb_list_documents 应支持按关键词过滤并返回稳定字段。',
            data: result.keywordFiltered
          }
        )

        runtime.assertThat(
          result.requestedSubset.total === 1 &&
            result.requestedSubset.items[0]?.id === 'doc-2' &&
            result.emptySubset.total === 0 &&
            result.emptySubset.items.length === 0,
          {
            name: 'list-documents-narrows-to-requested-document-ids',
            message: 'documentIds 只能在 run scope 内继续收窄，超出范围时应稳定返回空列表。',
            data: {
              requestedSubset: result.requestedSubset,
              emptySubset: result.emptySubset
            }
          }
        )
      }
    })
  })
})

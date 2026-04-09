import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

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
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description: '验证 kb_list_documents 的列表、过滤和资料范围收敛契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedKb([
          {
            id: 'doc-1',
            name: 'AI Tool Guide.md',
            chunks: [
              {
                id: 'chunk-1',
                text: 'AI tool guide document mentions stable kb list scope.'
              }
            ]
          },
          {
            id: 'doc-2',
            name: 'Release Checklist.md',
            chunks: [
              {
                id: 'chunk-2',
                text: 'Release checklist document covers rollout steps.'
              }
            ]
          },
          {
            id: 'doc-3',
            name: 'Archive Notes.md',
            workspaceId: 'other-workspace',
            chunks: [
              {
                id: 'chunk-3',
                text: 'Archive notes should stay out of current run scope.'
              }
            ]
          }
        ])

        const harness = createRetrievalToolHarness(runtime)

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
            message: 'kb_list_documents 默认应只返回当前工作区范围内的文档。',
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
            message: 'documentIds 只能在当前工作区范围内继续收窄，超出工作区时应稳定返回空列表。',
            data: {
              requestedSubset: result.requestedSubset,
              emptySubset: result.emptySubset
            }
          }
        )
      }
    })
  }, 600_000)
})

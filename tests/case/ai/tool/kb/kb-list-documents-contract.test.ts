import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type KbListDocumentsResult = {
  items: Array<{
    id: string
    name: string
    sourceType: 'file' | 'web'
    filePath?: string
    sourceUrl?: string
  }>
  total: number
}

describe('ai tool kb backend', () => {
  it('kb-list-documents-contract', async () => {
    await runBackendCase({
      caseId: 'kb-list-documents-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description: '验证 kb_list_documents 的列表、过滤和 documentIds 缩圈契约。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.seedKb([
          {
            id: 'doc-1',
            name: 'AI Tool Guide.md',
            filePath: '/workspace/AI Tool Guide.md',
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
            id: 'doc-web',
            name: 'LangChain overview - Docs by LangChain',
            sourceType: 'web',
            sourceUrl: 'https://docs.langchain.com/oss/javascript/langchain/overview',
            chunks: [
              {
                id: 'chunk-web',
                text: 'LangChain overview document covers createAgent and tools.'
              }
            ]
          }
        ])

        const harness = createRetrievalToolHarness(runtime)

        return {
          allDocs: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {}),
          sourceNameFiltered: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            sourceNameQuery: 'Guide'
          }),
          webFiltered: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            sourceNameQuery: 'LangChain'
          }),
          requestedSubset: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            documentIds: ['doc-2', 'doc-missing']
          }),
          emptySubset: await harness.invoke<KbListDocumentsResult>('kb_list_documents', {
            documentIds: ['doc-missing']
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.allDocs.total === 3 &&
            ['doc-1', 'doc-2', 'doc-web'].every((id) =>
              result.allDocs.items.some((item) => item.id === id)
            ),
          {
            name: 'list-documents-returns-seeded-file-and-web-docs',
            message:
              'kb_list_documents 默认应返回已索引的文件地址文档与全局网页文档。',
            data: {
              ids: result.allDocs.items.map((item) => item.id),
              total: result.allDocs.total
            }
          }
        )

        runtime.assertThat(
          result.webFiltered.total === 1 &&
            result.webFiltered.items[0]?.id === 'doc-web' &&
            result.webFiltered.items[0]?.sourceType === 'web' &&
            result.webFiltered.items[0]?.sourceUrl ===
              'https://docs.langchain.com/oss/javascript/langchain/overview',
          {
            name: 'list-documents-preserves-web-source-url',
            message:
              'kb_list_documents should expose sourceType and sourceUrl for web knowledge documents.',
            data: result.webFiltered
          }
        )

        runtime.assertThat(
          result.sourceNameFiltered.total === 1 &&
            result.sourceNameFiltered.items[0]?.id === 'doc-1' &&
            result.sourceNameFiltered.items[0]?.name === 'AI Tool Guide.md' &&
            result.sourceNameFiltered.items[0]?.sourceType === 'file' &&
            result.sourceNameFiltered.items[0]?.filePath === '/workspace/AI Tool Guide.md' &&
            !result.sourceNameFiltered.items[0]?.sourceUrl,
          {
            name: 'list-documents-supports-source-name-filter',
            message: 'kb_list_documents 应支持按 sourceNameQuery 过滤并返回稳定字段。',
            data: result.sourceNameFiltered
          }
        )

        runtime.assertThat(
          result.requestedSubset.total === 1 &&
            result.requestedSubset.items[0]?.id === 'doc-2' &&
            result.emptySubset.total === 0 &&
            result.emptySubset.items.length === 0,
          {
            name: 'list-documents-narrows-to-requested-document-ids',
            message: 'documentIds 只做进一步缩圈；不存在的 id 不应出现在结果中。',
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

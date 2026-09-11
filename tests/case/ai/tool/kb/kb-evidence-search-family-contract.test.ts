import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type KbSearchRow = {
  id: string
  text: string
  documentId?: string
  documentName: string
  sourceType?: string
  filePath?: string
  sourceUrl?: string
}

type KbSearchResult = {
  items: KbSearchRow[]
  total: number
}

describe('ai tool kb backend', () => {
  it('kb-evidence-search-family-contract', async () => {
    await runBackendCase({
      caseId: 'kb-evidence-search-family-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description:
        '验证 kb_search 在 auto/semantic/keyword 三种 strategy 下的统一返回结构和缩圈契约。',
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
                text: 'Approval denied should keep existing files unchanged.'
              }
            ]
          },
          {
            id: 'doc-2',
            name: 'Release Checklist.md',
            createdAt: 200,
            chunks: [
              {
                id: 'chunk-2',
                text: 'Terminal artifacts must be declared and recorded.'
              }
            ]
          },
          {
            id: 'doc-web',
            name: 'LangChain overview - Docs by LangChain',
            sourceType: 'web',
            sourceUrl: 'https://docs.langchain.com/oss/javascript/langchain/overview',
            createdAt: 100,
            chunks: [
              {
                id: 'chunk-web',
                text: 'LangChain provides createAgent for creating an agent with model and tools.'
              }
            ]
          },
          {
            id: 'doc-filename-anchor',
            name: '季度销售数据.xlsx',
            filePath: '/workspace/季度销售数据.xlsx',
            chunks: [
              {
                id: 'chunk-filename-anchor',
                text: '文件名：季度销售数据.xlsx\n标题：2026年度销售汇总\n工作表：季度销售、客户明细'
              }
            ]
          }
        ])

        const harness = createRetrievalToolHarness(runtime)

        const hybridSearch = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'approval denied unchanged files',
          strategy: 'auto',
          limit: 5
        })
        const vectorSubset = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'terminal artifacts recorded',
          strategy: 'semantic',
          limit: 5,
          documentIds: ['doc-2', 'doc-missing']
        })
        const emptySubset = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'terminal artifacts recorded',
          strategy: 'keyword',
          limit: 5,
          documentIds: ['doc-missing']
        })
        const fileHit = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'approval denied unchanged files',
          strategy: 'keyword',
          limit: 5,
          documentIds: ['doc-1']
        })
        const webHit = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'LangChain createAgent model tools',
          strategy: 'keyword',
          limit: 5,
          documentIds: ['doc-web']
        })
        const filenameHit = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: '季度销售数据',
          strategy: 'keyword',
          limit: 5
        })
        const sheetNameHit = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: '客户明细',
          strategy: 'keyword',
          limit: 5
        })

        return {
          hybridSearch,
          vectorSubset,
          emptySubset,
          fileHit,
          webHit,
          filenameHit,
          sheetNameHit
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.hybridSearch.total >= 1 &&
            result.hybridSearch.items.every(
              (row) =>
                (row.documentId === 'doc-1' ||
                  row.documentId === 'doc-2' ||
                  row.documentId === 'doc-web' ||
                  row.documentId === 'doc-filename-anchor') &&
                typeof row.documentName === 'string' &&
                typeof row.text === 'string'
            ) &&
            result.hybridSearch.items.some((row) => row.documentId === 'doc-1'),
          {
            name: 'hybrid-search-returns-stable-rows',
            message: 'kb_search(auto) 应返回稳定 rows 结构。',
            data: result.hybridSearch
          }
        )

        runtime.assertThat(
          result.vectorSubset.total >= 1 &&
            result.vectorSubset.items.every((row) => row.documentId === 'doc-2'),
          {
            name: 'vector-search-honors-explicit-document-scope',
            message: 'kb_search(semantic) 应遵守 documentIds 缩圈，忽略不存在的 id。',
            data: result.vectorSubset
          }
        )

        runtime.assertThat(
          result.emptySubset.total === 0 && result.emptySubset.items.length === 0,
          {
            name: 'fts-search-returns-empty-for-missing-document-ids',
            message: 'kb_search(keyword) 在 documentIds 全部不存在时应返回空结果。',
            data: result.emptySubset
          }
        )

        runtime.assertThat(
          result.fileHit.total >= 1 &&
            result.fileHit.items.some(
              (row) =>
                row.documentId === 'doc-1' &&
                row.sourceType === 'file' &&
                row.filePath === '/workspace/AI Tool Guide.md' &&
                !row.sourceUrl
            ),
          {
            name: 'knowledge-search-preserves-file-source-path',
            message:
              'kb_search should expose sourceType and filePath so AI can cite file knowledge as a local path.',
            data: result.fileHit
          }
        )

        runtime.assertThat(
          result.webHit.total >= 1 &&
            result.webHit.items.some(
              (row) =>
                row.documentId === 'doc-web' &&
                row.sourceType === 'web' &&
                row.sourceUrl === 'https://docs.langchain.com/oss/javascript/langchain/overview'
            ),
          {
            name: 'knowledge-search-preserves-web-source-url',
            message:
              'kb_search should expose sourceType and sourceUrl so AI can cite web knowledge as a URL.',
            data: result.webHit
          }
        )

        runtime.assertThat(
          result.filenameHit.total >= 1 &&
            result.filenameHit.items.some(
              (row) =>
                row.documentId === 'doc-filename-anchor' &&
                row.filePath === '/workspace/季度销售数据.xlsx' &&
                row.text.includes('季度销售数据.xlsx')
            ),
          {
            name: 'knowledge-search-hits-filename-anchor-chunk',
            message:
              'kb_search(keyword) 应能按文件名命中文档元数据锚点 chunk，让 excel 等仅元数据索引的文档可被查找到。',
            data: result.filenameHit
          }
        )

        runtime.assertThat(
          result.sheetNameHit.total >= 1 &&
            result.sheetNameHit.items.some(
              (row) => row.documentId === 'doc-filename-anchor' && row.text.includes('客户明细')
            ),
          {
            name: 'knowledge-search-hits-spreadsheet-sheet-name',
            message:
              'kb_search(keyword) 应能命中 excel 元数据中的工作表名，支持按 sheet 名称查找工作簿。',
            data: result.sheetNameHit
          }
        )
      }
    })
  })
})

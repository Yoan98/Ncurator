import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type KbSearchRow = {
  id: string
  text: string
  document_id?: string
  document_name: string
  source_type?: string
  file_path?: string
  source_url?: string
  _score?: number
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
        '验证 kb_search 在 auto/semantic/keyword 三种 strategy 下的统一返回结构和范围约束。',
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
          },
          {
            id: 'doc-3',
            name: 'Archive Notes.md',
            workspaceId: 'other-workspace',
            chunks: [
              {
                id: 'chunk-3',
                text: 'Out of scope notes should never be returned.'
              }
            ]
          }
        ])

        const harness = createRetrievalToolHarness(runtime)

        const hybridInScope = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'approval denied unchanged files',
          strategy: 'auto',
          limit: 5
        })
        const vectorSubset = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'terminal artifacts recorded',
          strategy: 'semantic',
          limit: 5,
          documentIds: ['doc-2', 'doc-3']
        })
        const ftsOutOfScope = await harness.invoke<KbSearchResult>('kb_search', {
          queryText: 'out of scope notes',
          strategy: 'keyword',
          limit: 5,
          documentIds: ['doc-3']
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
          hybridInScope,
          vectorSubset,
          ftsOutOfScope,
          fileHit,
          webHit,
          filenameHit,
          sheetNameHit
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.hybridInScope.total >= 1 &&
            result.hybridInScope.items.every(
              (row) =>
                (row.document_id === 'doc-1' ||
                  row.document_id === 'doc-2' ||
                  row.document_id === 'doc-web' ||
                  row.document_id === 'doc-filename-anchor') &&
                typeof row.document_name === 'string' &&
                typeof row.text === 'string'
            ) &&
            result.hybridInScope.items.some((row) => row.document_id === 'doc-1'),
          {
            name: 'hybrid-search-returns-stable-rows',
            message: 'kb_search(auto) 应返回稳定 rows 结构，并默认限制在当前工作区范围内。',
            data: result.hybridInScope
          }
        )

        runtime.assertThat(
          result.vectorSubset.total >= 1 &&
            result.vectorSubset.items.every((row) => row.document_id === 'doc-2'),
          {
            name: 'vector-search-honors-explicit-document-scope',
            message: 'kb_search(semantic) 应继续遵守 documentIds 在当前工作区内的收窄范围。',
            data: result.vectorSubset
          }
        )

        runtime.assertThat(
          result.ftsOutOfScope.total === 0 && result.ftsOutOfScope.items.length === 0,
          {
            name: 'fts-search-rejects-out-of-scope-document-ids',
            message:
              'kb_search(keyword) 在 requested documentIds 完全超出当前工作区时应返回空结果。',
            data: result.ftsOutOfScope
          }
        )

        runtime.assertThat(
          result.fileHit.total >= 1 &&
            result.fileHit.items.some(
              (row) =>
                row.document_id === 'doc-1' &&
                row.source_type === 'file' &&
                row.file_path === '/workspace/AI Tool Guide.md' &&
                !row.source_url
            ),
          {
            name: 'knowledge-search-preserves-file-source-path',
            message:
              'kb_search should expose source_type and file_path so AI can cite file knowledge as a local path.',
            data: result.fileHit
          }
        )

        runtime.assertThat(
          result.webHit.total >= 1 &&
            result.webHit.items.some(
              (row) =>
                row.document_id === 'doc-web' &&
                row.source_type === 'web' &&
                row.source_url === 'https://docs.langchain.com/oss/javascript/langchain/overview'
            ),
          {
            name: 'knowledge-search-preserves-web-source-url',
            message:
              'kb_search should expose source_type and source_url so AI can cite web knowledge as a URL.',
            data: result.webHit
          }
        )

        runtime.assertThat(
          result.filenameHit.total >= 1 &&
            result.filenameHit.items.some(
              (row) =>
                row.document_id === 'doc-filename-anchor' &&
                row.file_path === '/workspace/季度销售数据.xlsx' &&
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
              (row) => row.document_id === 'doc-filename-anchor' && row.text.includes('客户明细')
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

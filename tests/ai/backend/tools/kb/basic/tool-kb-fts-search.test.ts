import { createRetrievalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, createSearchResult } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-kb-fts-search',
  caseType: 'basic',
  groups: ['kb', 'basic'],
  description: '验证 FTS 检索能返回关键词精确命中结果并携带文档信息。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let observed: {
      queryText: string
      limit: number
      sourceType?: string
    } | null = null

    const harness = createRetrievalToolHarness(runtime, {
      documentsStoreOverrides: {
        ftsSearch: async (queryText, limit, sourceType) => {
          observed = {
            queryText,
            limit,
            sourceType
          }
          return [
            createSearchResult({
              id: 'chunk-fts-1',
              text: 'approval denied should stop overwrite branch safely',
              documentId: 'doc-fts-1',
              documentName: 'approval-playbook.md'
            }),
            createSearchResult({
              id: 'chunk-fts-2',
              text: 'approval denied follow-up can continue with read-only actions',
              documentId: 'doc-fts-2',
              documentName: 'terminal-guidelines.md'
            })
          ]
        }
      }
    })

    const result = await harness.invoke<
      Array<{ id: string; text: string; document_id?: string; document_name: string }>
    >('kb_fts_search_chunks', {
      queryText: 'approval denied',
      limit: 3,
      sourceType: 'file'
    })

    return {
      result,
      observed
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      Boolean(result.observed) &&
        result.observed?.queryText === 'approval denied' &&
        result.observed?.limit === 3 &&
        result.observed?.sourceType === 'file',
      {
        name: 'kb-fts-params',
        message: 'FTS 检索应按原始关键词和过滤条件执行'
      }
    )
    runtime.assertThat(
      result.result.length === 2 &&
        result.result.every((item) => item.text.includes('approval denied')) &&
        result.result.every((item) => Boolean(item.document_name)),
      {
        name: 'kb-fts-result',
        message: 'FTS 检索应返回关键词命中结果并保留文档名'
      }
    )
  }
})

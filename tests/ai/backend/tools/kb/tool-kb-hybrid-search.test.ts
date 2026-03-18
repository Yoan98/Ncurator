import { createRetrievalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, createSearchResult } from '../helpers'

defineAiToolCase({
  caseId: 'tool-kb-hybrid-search',
  caseType: 'basic',
  groups: ['kb'],
  description: '验证 hybrid 检索会按 source scope 做 documentIds 交集并返回可引用结果。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let observed: {
      queryText: string
      limit: number
      sourceType?: string
      documentIds?: string[]
    } | null = null

    const harness = createRetrievalToolHarness(runtime, {
      selectedDocumentIds: ['doc-alpha', 'doc-beta'],
      documentsStoreOverrides: {
        hybridSearch: async (_vector, queryText, limit, sourceType, documentIds) => {
          observed = {
            queryText,
            limit,
            sourceType,
            documentIds
          }
          if (documentIds?.includes('doc-beta')) {
            return [
              createSearchResult({
                id: 'chunk-beta-1',
                text: 'Approval flow still needs regression coverage.',
                documentId: 'doc-beta',
                documentName: 'release-checklist.md',
                score: 0.91
              })
            ]
          }
          return []
        }
      }
    })

    const result = await harness.invoke<
      Array<{ id: string; text: string; document_id?: string; document_name: string }>
    >('kb_hybrid_search_chunks', {
      queryText: 'approval flow regression',
      limit: 5,
      sourceType: 'file',
      documentIds: ['doc-beta', 'doc-gamma']
    })

    return {
      result,
      observed
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      Boolean(result.observed) &&
        result.observed?.queryText === 'approval flow regression' &&
        result.observed?.limit === 5 &&
        result.observed?.sourceType === 'file' &&
        JSON.stringify(result.observed?.documentIds || []) === JSON.stringify(['doc-beta']),
      {
        name: 'kb-hybrid-scope-forwarded',
        message: 'hybrid 检索应把运行范围和请求范围收敛为 documentIds 交集'
      }
    )
    runtime.assertThat(
      result.result.length === 1 &&
        result.result[0].document_id === 'doc-beta' &&
        result.result[0].text.includes('regression coverage'),
      {
        name: 'kb-hybrid-result',
        message: 'hybrid 检索应返回 scope 内可消费的结果'
      }
    )
  }
})

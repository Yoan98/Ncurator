import { createRetrievalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, createSearchResult } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-kb-vector-search',
  caseType: 'basic',
  groups: ['kb', 'basic'],
  description: '验证 vector-only 检索的基础返回质量与参数透传。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    let observed: {
      limit: number
      sourceType?: string
      documentIds?: string[]
    } | null = null

    const harness = createRetrievalToolHarness(runtime, {
      documentsStoreOverrides: {
        vectorSearch: async (_vector, limit, sourceType, documentIds) => {
          observed = {
            limit,
            sourceType,
            documentIds
          }
          return [
            createSearchResult({
              id: 'chunk-vector-1',
              text: 'Semantic retrieval matched integration rollback guidance.',
              documentId: 'doc-vector',
              documentName: 'operations-handbook.md',
              score: 0.88
            })
          ]
        }
      }
    })

    const result = await harness.invoke<
      Array<{ id: string; text: string; document_id?: string; document_name: string }>
    >('kb_vector_search_chunks', {
      queryText: 'integration rollback guidance',
      limit: 2,
      sourceType: 'file',
      documentIds: ['doc-vector']
    })

    return {
      result,
      observed
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      Boolean(result.observed) &&
        result.observed?.limit === 2 &&
        result.observed?.sourceType === 'file' &&
        JSON.stringify(result.observed?.documentIds || []) === JSON.stringify(['doc-vector']),
      {
        name: 'kb-vector-params',
        message: 'vector 检索应按原样透传 limit、sourceType 与 documentIds'
      }
    )
    runtime.assertThat(
      result.result.length === 1 &&
        result.result[0].document_id === 'doc-vector' &&
        result.result[0].text.includes('rollback guidance'),
      {
        name: 'kb-vector-result',
        message: 'vector 检索应返回语义相关的单条结果'
      }
    )
  }
})

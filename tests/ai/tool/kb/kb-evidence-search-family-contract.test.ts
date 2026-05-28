import { describe, it } from 'vitest'
import { createRetrievalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type KbSearchRow = {
  id: string
  text: string
  document_id?: string
  document_name: string
  source_type?: string
  _score?: number
}

describe('ai tool kb backend', () => {
  it('kb-evidence-search-family-contract', async () => {
    await runBackendCase({
      caseId: 'kb-evidence-search-family-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['kb'],
      description: '验证 kb_search 在 auto/semantic/keyword 三种 strategy 下的统一返回结构和范围约束。',
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
                text: 'Approval denied should keep existing files unchanged.'
              }
            ]
          },
          {
            id: 'doc-2',
            name: 'Release Checklist.md',
            chunks: [
              {
                id: 'chunk-2',
                text: 'Terminal artifacts must be declared and recorded.'
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

        const hybridInScope = await harness.invoke<KbSearchRow[]>('kb_search', {
          queryText: 'approval denied unchanged files',
          strategy: 'auto',
          limit: 5
        })
        const vectorSubset = await harness.invoke<KbSearchRow[]>('kb_search', {
          queryText: 'terminal artifacts recorded',
          strategy: 'semantic',
          limit: 5,
          documentIds: ['doc-2', 'doc-3']
        })
        const ftsOutOfScope = await harness.invoke<KbSearchRow[]>('kb_search', {
          queryText: 'out of scope notes',
          strategy: 'keyword',
          limit: 5,
          documentIds: ['doc-3']
        })

        return {
          hybridInScope,
          vectorSubset,
          ftsOutOfScope
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.hybridInScope.length >= 1 &&
            result.hybridInScope.every(
              (row) =>
                (row.document_id === 'doc-1' || row.document_id === 'doc-2') &&
                typeof row.document_name === 'string' &&
                typeof row.text === 'string'
            ) &&
            result.hybridInScope.some((row) => row.document_id === 'doc-1'),
          {
            name: 'hybrid-search-returns-stable-rows',
            message: 'kb_search(auto) 应返回稳定 rows 结构，并默认限制在当前工作区范围内。',
            data: result.hybridInScope
          }
        )

        runtime.assertThat(
          result.vectorSubset.length >= 1 &&
            result.vectorSubset.every((row) => row.document_id === 'doc-2'),
          {
            name: 'vector-search-honors-explicit-document-scope',
            message: 'kb_search(semantic) 应继续遵守 documentIds 在当前工作区内的收窄范围。',
            data: result.vectorSubset
          }
        )

        runtime.assertThat(result.ftsOutOfScope.length === 0, {
          name: 'fts-search-rejects-out-of-scope-document-ids',
          message: 'kb_search(keyword) 在 requested documentIds 完全超出当前工作区时应返回空结果。',
          data: result.ftsOutOfScope
        })
      }
    })
  })
})

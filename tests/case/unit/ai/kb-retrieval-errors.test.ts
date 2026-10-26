import { describe, expect, it, vi } from 'vitest'
import { buildKbCapabilityTools } from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { renderKbSearchModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

describe('KB query failures', () => {
  it('reports scoped incomplete semantic coverage while keywords remain readable', async () => {
    await runBackendCase({
      caseId: 'kb-partial-semantic-coverage',
      domain: 'unit',
      suite: 'ai',
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '模拟嵌入查询保留真实正文检索并向模型投递覆盖不足。',
      assert: async () => {},
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const workspaceId = ctx.workspace?.workspaceId || ''
        await runtime.documentsStore.addDocument({
          id: 'old-index',
          name: '资料.txt',
          source_type: 'file',
          workspace_id: workspaceId,
          file_path: '/isolated/资料.txt',
          created_at: 1,
          import_status: 2,
          active_generation_id: 'generation-1',
          content_hash: 'hash-1'
        })
        await runtime.documentsStore.addChunks({
          chunks: [
            {
              id: 'old-chunk',
              text: 'quartz migration coverage',
              document_id: 'old-index',
              workspace_id: workspaceId,
              document_name: '资料.txt',
              source_type: 'file',
              metadata: { page: 1 }
            }
          ],
          vectors: [Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))],
          generationId: 'generation-1'
        })
        await runtime.embeddingService.configure({
          executor: {
            initialize: async () => undefined,
            embed: async () => ({ data: Float32Array.from([1, 2, 3]), dims: [1, 3] })
          },
          modelName: 'unit-model',
          identity: 'remote:unit-model',
          kind: 'remote'
        })
        const tools = buildKbCapabilityTools({ ctx, runId: runtime.runId })
        const search = tools.find((entry) => entry.name === 'kb_search')!
        const keyword = await search.invoke({
          queryText: 'quartz',
          strategy: 'keyword',
          sourceType: 'file'
        })
        expect(keyword).toMatchObject({
          total: 1,
          semanticCoverage: { total: 1, completed: 0, pending: 1, failed: 0 }
        })
        expect(
          await search.invoke({ queryText: 'quartz', strategy: 'semantic', sourceType: 'file' })
        ).toMatchObject({ total: 0, semanticCoverage: { total: 1, completed: 0 } })
        expect(
          await search.invoke({ queryText: 'quartz', strategy: 'keyword', sourceType: 'web' })
        ).toEqual({ items: [], total: 0 })
        const rendered = await renderKbSearchModelResult({
          data: keyword,
          toolName: 'kb_search',
          args: {}
        } as Parameters<typeof renderKbSearchModelResult>[0])
        expect(rendered).toContain('Semantic index coverage is incomplete')
        expect(rendered).toContain('quartz migration coverage')
      }
    })
  })

  it('rejects a semantic result if the model changes while the vector search is in flight', async () => {
    await runBackendCase({
      caseId: 'kb-query-model-switch',
      domain: 'unit',
      suite: 'ai',
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '查询完成前模型身份改变时显式要求重试。',
      assert: async () => {},
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const configure = (identity: string) =>
          runtime.embeddingService.configure({
            executor: {
              initialize: async () => undefined,
              embed: async () => ({ data: Float32Array.from([1, 2, 3]), dims: [1, 3] })
            },
            modelName: identity,
            identity,
            kind: 'remote'
          })
        await configure('remote:first')
        const search = buildKbCapabilityTools({ ctx, runId: runtime.runId }).find(
          (entry) => entry.name === 'kb_search'
        )!
        const vectorSearch = vi
          .spyOn(runtime.documentsStore, 'vectorSearch')
          .mockImplementationOnce(async () => {
            await configure('remote:second')
            return []
          })
        try {
          await expect(
            search.invoke({ queryText: 'quartz', strategy: 'semantic' })
          ).rejects.toThrow('向量模型已切换')
        } finally {
          vectorSearch.mockRestore()
        }
      }
    })
  })

  it('never falls back to keyword search after an embedding failure', async () => {
    await runBackendCase({
      caseId: 'kb-retrieval-errors',
      domain: 'unit',
      suite: 'ai',
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '向量计算故障不能变成关键词结果。',
      assert: async () => {},
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        // Unit-only fault injection isolates the query failure from availability checks.
        const available = vi.spyOn(ctx, 'assertKbAvailable').mockResolvedValue(undefined)
        const embed = vi
          .spyOn(runtime.embeddingService, 'embed')
          .mockRejectedValue(new Error('embedding computation failed'))
        const keyword = vi.spyOn(runtime.documentsStore, 'ftsSearch')
        try {
          const search = buildKbCapabilityTools({ ctx, runId: runtime.runId }).find(
            (tool) => tool.name === 'kb_search'
          )!
          for (const strategy of ['auto', 'semantic']) {
            await expect(search.invoke({ queryText: 'query', strategy })).rejects.toThrow(
              'embedding computation failed'
            )
          }
          expect(keyword).not.toHaveBeenCalled()
        } finally {
          available.mockRestore()
          embed.mockRestore()
          keyword.mockRestore()
        }
      }
    })
  })
})

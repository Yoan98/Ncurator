import { describe, expect, it, vi } from 'vitest'
import { buildKbCapabilityTools } from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('KB query failures', () => {
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

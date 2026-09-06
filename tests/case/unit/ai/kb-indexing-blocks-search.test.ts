import { describe, expect, it } from 'vitest'
import {
  buildKbCapabilityTools,
  KB_INDEXING_IN_PROGRESS_ERROR
} from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'

const invokeTool = async (
  ctx: KnowledgeRetrievalContext,
  name: 'kb_search' | 'kb_list_documents',
  args: Record<string, unknown>
) => {
  const tools = buildKbCapabilityTools({ ctx, runId: ctx.runId })
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`missing ${name}`)
  return await tool.invoke(args)
}

describe('ai unit kb indexing blocks search', () => {
  it('fails kb_search and kb_list_documents while a prepare index job is running', async () => {
    const ctx = {
      runId: 'run-kb-indexing',
      checkCancelled: () => undefined,
      sendEvent: () => undefined,
      documentsStore: {} as KnowledgeRetrievalContext['documentsStore'],
      embeddingService: {} as KnowledgeRetrievalContext['embeddingService'],
      assertKbSearchAvailable: async () => {
        throw new Error(KB_INDEXING_IN_PROGRESS_ERROR)
      }
    } as KnowledgeRetrievalContext

    await expect(invokeTool(ctx, 'kb_search', { queryText: '合同' })).rejects.toThrow(
      KB_INDEXING_IN_PROGRESS_ERROR
    )
    await expect(invokeTool(ctx, 'kb_list_documents', {})).rejects.toThrow(
      KB_INDEXING_IN_PROGRESS_ERROR
    )
  })
})

import { describe, expect, it } from 'vitest'
import { buildModelToolResultDelivery } from '../../../../src/main/services/ai/human/shared/modelToolResult'
import {
  buildKbCapabilityTools,
  KB_INDEXING_IN_PROGRESS_ERROR
} from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { AiRunContext, KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'

const MODEL_FACING_INDEXING_ERROR = `Error: ${KB_INDEXING_IN_PROGRESS_ERROR}`

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

  it('delivers the indexing error into the model-facing kb tool result', async () => {
    for (const toolName of ['kb_search', 'kb_list_documents'] as const) {
      const delivery = await buildModelToolResultDelivery({
        ctx: { platform: 'win32' } as AiRunContext,
        toolCallId: `call-${toolName}`,
        args: toolName === 'kb_search' ? { queryText: '合同' } : {},
        result: {
          toolName,
          ok: false,
          data: { error: KB_INDEXING_IN_PROGRESS_ERROR }
        }
      })
      expect(delivery.ok).toBe(false)
      expect(delivery.content).toBe(MODEL_FACING_INDEXING_ERROR)
    }
  })
})

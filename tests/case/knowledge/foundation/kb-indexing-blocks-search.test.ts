import { describe, it } from 'vitest'
import { buildModelToolResultDelivery } from '../../../../src/main/services/ai/human/shared/modelToolResult'
import {
  buildKbCapabilityTools,
  KB_INDEXING_IN_PROGRESS_ERROR
} from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { AiRunContext, KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

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

describe('knowledge foundation', () => {
  it('kb-indexing-blocks-search', async () => {
    await runBackendCase({
      caseId: 'kb-indexing-blocks-search',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: 'prepare 索引进行中时 kb_search / kb_list_documents 失败并投递模型可读错误。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
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

        const searchError = await invokeTool(ctx, 'kb_search', { queryText: '合同' }).then(
          () => '',
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        )
        const listError = await invokeTool(ctx, 'kb_list_documents', {}).then(
          () => '',
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        )

        const deliveries = []
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
          deliveries.push({
            toolName,
            ok: delivery.ok,
            content: delivery.content
          })
        }

        return { searchError, listError, deliveries }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.searchError === KB_INDEXING_IN_PROGRESS_ERROR &&
            result.listError === KB_INDEXING_IN_PROGRESS_ERROR,
          {
            name: 'kb-tools-fail-while-indexing',
            message:
              '更新索引执行中 kb_search / kb_list_documents 应失败，对齐 SET-WORKSPACE-004-AC9、SET-WEB-004-AC8。',
            data: result
          }
        )
        runtime.assertThat(
          result.deliveries.length === 2 &&
            result.deliveries.every(
              (item) => item.ok === false && item.content === MODEL_FACING_INDEXING_ERROR
            ),
          {
            name: 'indexing-error-is-model-facing',
            message: '索引中错误应投递为模型可读的 Error: 正在更新知识库索引，请完成后再检索。',
            data: result.deliveries
          }
        )
      }
    })
  })
})

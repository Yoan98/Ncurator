import { describe, expect, it } from 'vitest'
import { buildModelToolResultDelivery } from '../../../../src/main/services/ai/human/shared/modelToolResult'
import {
  buildKbCapabilityTools,
  KB_INDEXING_IN_PROGRESS_ERROR
} from '../../../../src/main/services/ai/human/tools/kb/retrievalTools'
import type { KnowledgeRetrievalContext } from '../../../../src/main/services/ai/types'
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
      execute: async (runtime) => {
        const now = Date.now()
        await runtime.storageService.workspace.saveWorkspace({
          id: 'kb-indexing-blocks-search',
          root_path: runtime.workspaceRoot,
          created_at: now,
          updated_at: now
        })
        await runtime.storageService.workspaceIndexJob.saveJob({
          id: 'kb-indexing-running-prepare',
          workspace_id: 'kb-indexing-blocks-search',
          source_kind: 'file',
          action: 'prepare',
          status: 'running',
          phase: 'index',
          step_index: 1,
          step_total: 1,
          total_count: 1,
          processed_count: 0,
          failed_count: 0,
          target_ids: [],
          started_at: now,
          updated_at: now
        })
        const ctx = runtime.createAiRunContext()

        const searchError = await invokeTool(ctx, 'kb_search', { queryText: '合同' }).then(
          () => '',
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        )
        const listError = await invokeTool(ctx, 'kb_list_documents', {}).then(
          () => '',
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        )

        const jobStore = runtime.storageService.workspaceIndexJob
        const baseJob = await jobStore.getJobById('kb-indexing-running-prepare')
        if (!baseJob) throw new Error('missing prepare job')
        await jobStore.saveJob({ ...baseJob, source_kind: 'web' })
        for (const name of ['kb_search', 'kb_list_documents'] as const) {
          await expect(
            invokeTool(ctx, name, name === 'kb_search' ? { queryText: '合同' } : {})
          ).rejects.toThrow(KB_INDEXING_IN_PROGRESS_ERROR)
        }
        await runtime.prepareEmbeddingModel()
        for (const action of ['scan', 'prepare'] as const) {
          for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
            await jobStore.saveJob({ ...baseJob, action, status })
            expect(await invokeTool(ctx, 'kb_search', { queryText: '合同' })).toEqual({
              items: [],
              total: 0
            })
            expect(await invokeTool(ctx, 'kb_list_documents', {})).toEqual({ items: [], total: 0 })
          }
        }
        await jobStore.saveJob({ ...baseJob, action: 'scan', status: 'running' })
        expect(await invokeTool(ctx, 'kb_search', { queryText: '合同' })).toEqual({
          items: [],
          total: 0
        })
        expect(await invokeTool(ctx, 'kb_list_documents', {})).toEqual({ items: [], total: 0 })

        const deliveries = []
        for (const toolName of ['kb_search', 'kb_list_documents'] as const) {
          const delivery = await buildModelToolResultDelivery({
            ctx,
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
              (item) =>
                item.ok === false &&
                item.content.startsWith(MODEL_FACING_INDEXING_ERROR) &&
                item.content.includes('Do not call KB tools again')
            ),
          {
            name: 'indexing-error-is-model-facing',
            message: '索引中错误应保留预设英文原因及停止继续调用 KB 的指引。',
            data: result.deliveries
          }
        )
      }
    })
  })
})

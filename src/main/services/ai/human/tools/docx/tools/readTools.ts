import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type { DocxOutlineBlock } from '../types'
import { openSchema, outlineSchema, getBlockSchema, searchSchema, historySchema } from '../schemas'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'
import {
  createDocxTool,
  finalizeDocxToolSuccess,
  requireDocxToolDocId,
  runDocxWorkerToolAction
} from './workerTool'

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  type DocxOutlineResult = {
    ok: true
    code: 'ok'
    summary: string
    blocks: DocxOutlineBlock[]
    truncated: boolean
  }

  const docxOpenTool = createDocxTool({
    runtime,
    name: 'docx_open',
    description: 'Open a workspace-bound docx file and register a docId for subsequent operations.',
    schema: openSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_open',
        status: 'failed',
        summary: `文档打开异常: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sourcePath = runtime.resolveDocxPath({
        cwd: runtime.workspaceRootPath,
        rawPath: args.sourcePath
      })
      if (!sourcePath) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'sourcePath must be a workspace-bound .docx path'
        })
      }
      if (!fs.existsSync(sourcePath)) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'sourcePath not found'
        })
      }

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'open',
        activity: {
          actionType: 'docx_open',
          startedSummary: `打开文档: ${sourcePath}`,
          buildCompletedSummary: () => `文档已打开: ${path.basename(sourcePath)}`,
          buildFailedSummary: (failure) => `文档打开失败: ${failure.error}`
        },
        request: {
          action: 'open',
          payload: {
            sourcePath
          }
        },
        buildSuccess: (workerPayload) => {
          runtime.state.lastDocId = workerPayload.docId
          runtime.state.sourcePathByDocId.set(workerPayload.docId, sourcePath)
          runtime.registerSnapshot(workerPayload.docId)
          runtime.input.ctx.trackDocxOpen({
            docId: workerPayload.docId,
            sourcePath
          })
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `doc opened: ${path.basename(sourcePath)}`,
            docId: workerPayload.docId,
            meta: workerPayload.meta,
            stats: workerPayload.stats
          }
          return {
            result,
            outputPreview: result,
            draftDocId: workerPayload.docId
          }
        }
      })
    },
  })

  const docxOutlineTool = createDocxTool({
    runtime,
    name: 'docx_outline',
    description:
      'Extract a deterministic block outline for a previously opened doc (paragraph/table/table_cell).',
    schema: outlineSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_outline',
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      return await runDocxWorkerToolAction<'outline', DocxOutlineResult>({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'outline',
        draftDocId: docIdResult.docId,
        activity: {
          actionType: 'docx_outline',
          startedSummary: `提取结构: ${docIdResult.docId}`,
          buildCompletedSummary: (result) => `结构提取完成: ${String(result.blocks.length)} blocks`
        },
        request: {
          action: 'outline',
          payload: {
            docId: docIdResult.docId,
            maxBlocks: Number(args.maxBlocks || 200),
            includeTables: Boolean(args.includeTables ?? true),
            includeCells: Boolean(args.includeCells ?? true)
          }
        },
        buildSuccess: (workerPayload) => {
          const result: DocxOutlineResult = {
            ok: true,
            code: 'ok',
            summary: `outline ready (${workerPayload.blocks.length} blocks)`,
            blocks: workerPayload.blocks,
            truncated: workerPayload.truncated
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              blockCount: result.blocks.length,
              truncated: result.truncated
            },
            draftDocId: docIdResult.docId
          }
        }
      })
    },
  })

  const docxGetBlockTool = createDocxTool({
    runtime,
    name: 'docx_get_block',
    description: 'Get one block by blockId with detailed structure.',
    schema: getBlockSchema,
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'get_block',
        request: {
          action: 'get_block',
          payload: {
            docId: docIdResult.docId,
            blockId: args.blockId
          }
        },
        buildSuccess: (workerPayload) => {
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `block loaded: ${args.blockId}`,
            block: workerPayload.block
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              blockType: result.block.type
            },
            draftDocId: docIdResult.docId
          }
        }
      })
    },
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: 'docx_search',
    description:
      'Search blocks in a doc using literal/regex mode, or semantic block retrieval with cached embeddings.',
    schema: searchSchema,
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      if (args.mode === 'semantic') {
        const semanticIndex = await runtime.buildSemanticDocIndex(docIdResult.docId)
        const queryEmbeddingResponse = await runtime.input.ctx.embeddingService.embed(args.query)
        const queryEmbeddingRows = splitEmbeddingRows(
          queryEmbeddingResponse.data,
          queryEmbeddingResponse.dims
        )
        const queryEmbedding = queryEmbeddingRows[0]
        if (!queryEmbedding || queryEmbedding.length === 0) {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'semantic query embedding is empty'
          })
        }

        const matches = buildSemanticMatches({
          entries: semanticIndex.entries,
          queryEmbedding,
          scopeBlockIds: args.scope?.blockIds || [],
          queryText: args.query
        })
        const warnings =
          semanticIndex.entries.length === 0
            ? ['no searchable paragraph or table cell blocks found for semantic search']
            : []
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `semantic search done (${matches.length} matches)`,
          matches,
          warnings
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: result.ok,
            code: result.code,
            summary: result.summary,
            matchCount: result.matches.length,
            warnings: result.warnings
          },
          draftDocId: docIdResult.docId
        })
      }

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'search',
        request: {
          action: 'search',
          payload: {
            docId: docIdResult.docId,
            query: args.query,
            mode: args.mode,
            scopeBlockIds: args.scope?.blockIds || []
          }
        },
        buildSuccess: (workerPayload) => {
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `search done (${workerPayload.matches.length} matches)`,
            matches: workerPayload.matches,
            warnings: workerPayload.warnings
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              matchCount: result.matches.length,
              warnings: result.warnings
            },
            draftDocId: docIdResult.docId
          }
        }
      })
    },
  })

  const docxGetHistoryTool = createDocxTool({
    runtime,
    name: 'docx_get_history',
    description:
      'Inspect the immutable docx snapshot lineage for the current run. Useful for confirm/rollback flows before save.',
    schema: historySchema,
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      const history = runtime.buildSnapshotHistory(docIdResult.docId, Number(args.maxDepth || 10))
      if (history.length === 0) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'docId is not tracked in current docx snapshot history'
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `snapshot history loaded (${history.length} items)`,
        currentDocId: docIdResult.docId,
        snapshots: history
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: result.ok,
          code: result.code,
          summary: result.summary,
          snapshotCount: result.snapshots.length
        },
        draftDocId: docIdResult.docId
      })
    }
  })

  return [
    docxOpenTool,
    docxOutlineTool,
    docxGetBlockTool,
    docxSearchTool,
    docxGetHistoryTool
  ]
}

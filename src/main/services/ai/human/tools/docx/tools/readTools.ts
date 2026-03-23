import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { openSchema, outlineSchema, getBlockSchema, searchSchema, historySchema } from '../schemas'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'
import { callExpectedWorkerAction, createDocxTool, isDocxToolFailure } from './workerTool'

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
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

        runtime.input.emitActivity({
          actionType: 'docx_open',
          status: 'started',
          summary: `打开文档: ${sourcePath}`
        })

        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'open',
          request: {
            action: 'open',
            payload: {
              sourcePath
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) {
          runtime.input.emitActivity({
            actionType: 'docx_open',
            status: 'failed',
            summary: `文档打开失败: ${workerPayload.error}`
          })
          return workerPayload
        }

        runtime.state.lastDocId = workerPayload.docId
        runtime.state.sourcePathByDocId.set(workerPayload.docId, sourcePath)
        runtime.registerSnapshot(workerPayload.docId)
        runtime.input.ctx.trackDocxOpen({
          docId: workerPayload.docId,
          sourcePath
        })
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc opened: ${path.basename(sourcePath)}`,
          docId: workerPayload.docId,
          meta: workerPayload.meta,
          stats: workerPayload.stats
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: workerPayload.docId
        })
        runtime.input.emitActivity({
          actionType: 'docx_open',
          status: 'completed',
          summary: `文档已打开: ${path.basename(sourcePath)}`
        })
        return out
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
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        runtime.input.emitActivity({
          actionType: 'docx_outline',
          status: 'started',
          summary: `提取结构: ${docId}`
        })
        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'outline',
          draftDocId: docId,
          request: {
            action: 'outline',
            payload: {
              docId,
              maxBlocks: Number(args.maxBlocks || 200),
              includeTables: Boolean(args.includeTables ?? true),
              includeCells: Boolean(args.includeCells ?? true)
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) {
          runtime.input.emitActivity({
            actionType: 'docx_outline',
            status: 'failed',
            summary: workerPayload.summary
          })
          return workerPayload
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `outline ready (${workerPayload.blocks.length} blocks)`,
          blocks: workerPayload.blocks,
          truncated: workerPayload.truncated
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            blockCount: out.blocks.length,
            truncated: out.truncated
          },
          draftDocId: docId
        })
        runtime.input.emitActivity({
          actionType: 'docx_outline',
          status: 'completed',
          summary: `结构提取完成: ${out.blocks.length} blocks`
        })
        return out
    },
  })

  const docxGetBlockTool = createDocxTool({
    runtime,
    name: 'docx_get_block',
    description: 'Get one block by blockId with detailed structure.',
    schema: getBlockSchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'get_block',
          request: {
            action: 'get_block',
            payload: {
              docId,
              blockId: args.blockId
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) return workerPayload
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `block loaded: ${args.blockId}`,
          block: workerPayload.block
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            blockType: out.block.type
          },
          draftDocId: docId
        })
        return out
    },
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: 'docx_search',
    description:
      'Search blocks in a doc using literal/regex mode, or semantic block retrieval with cached embeddings.',
    schema: searchSchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        if (args.mode === 'semantic') {
          const semanticIndex = await runtime.buildSemanticDocIndex(docId)
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
          const out = {
            ok: true,
            code: 'ok' as const,
            summary: `semantic search done (${matches.length} matches)`,
            matches,
            warnings
          }
          runtime.toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: {
              ok: out.ok,
              code: out.code,
              summary: out.summary,
              matchCount: out.matches.length,
              warnings: out.warnings
            },
            draftDocId: docId
          })
          return out
        }

        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'search',
          request: {
            action: 'search',
            payload: {
              docId,
              query: args.query,
              mode: args.mode,
              scopeBlockIds: args.scope?.blockIds || []
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) return workerPayload
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `search done (${workerPayload.matches.length} matches)`,
          matches: workerPayload.matches,
          warnings: workerPayload.warnings
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            matchCount: out.matches.length,
            warnings: out.warnings
          },
          draftDocId: docId
        })
        return out
    },
  })

  const docxGetHistoryTool = createDocxTool({
    runtime,
    name: 'docx_get_history',
    description:
      'Inspect the immutable docx snapshot lineage for the current run. Useful for confirm/rollback flows before save.',
    schema: historySchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const history = runtime.buildSnapshotHistory(docId, Number(args.maxDepth || 10))
        if (history.length === 0) {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: 'docId is not tracked in current docx snapshot history'
          })
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `snapshot history loaded (${history.length} items)`,
          currentDocId: docId,
          snapshots: history
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            snapshotCount: out.snapshots.length
          },
          draftDocId: docId
        })
        return out
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

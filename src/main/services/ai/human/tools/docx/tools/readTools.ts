import fs from 'node:fs'
import path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import { openSchema, outlineSchema, getBlockSchema, searchSchema, historySchema } from '../schemas'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxOpenTool = tool(
    async (args) => {
      const toolName = 'docx_open'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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

        const workerResponse = await runtime.callWorker({
          action: 'open',
          payload: {
            sourcePath
          }
        })
        if (!workerResponse.ok) {
          const out = runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
          runtime.input.emitActivity({
            actionType: 'docx_open',
            status: 'failed',
            summary: `文档打开失败: ${workerResponse.error}`
          })
          return out
        }
        if (workerResponse.payload.action !== 'open') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (open)'
          })
        }

        runtime.state.lastDocId = workerResponse.payload.docId
        runtime.state.sourcePathByDocId.set(workerResponse.payload.docId, sourcePath)
        runtime.registerSnapshot(workerResponse.payload.docId)
        runtime.input.ctx.trackDocxOpen({
          docId: workerResponse.payload.docId,
          sourcePath
        })
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc opened: ${path.basename(sourcePath)}`,
          docId: workerResponse.payload.docId,
          meta: workerResponse.payload.meta,
          stats: workerResponse.payload.stats
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: workerResponse.payload.docId
        })
        runtime.input.emitActivity({
          actionType: 'docx_open',
          status: 'completed',
          summary: `文档已打开: ${path.basename(sourcePath)}`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        runtime.input.emitActivity({
          actionType: 'docx_open',
          status: 'failed',
          summary: `文档打开异常: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_open',
      description: 'Open a workspace-bound docx file and register a docId for subsequent operations.',
      schema: openSchema
    }
  )

  const docxOutlineTool = tool(
    async (args) => {
      const toolName = 'docx_outline'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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
        const workerResponse = await runtime.callWorker({
          action: 'outline',
          payload: {
            docId,
            maxBlocks: Number(args.maxBlocks || 200),
            includeTables: Boolean(args.includeTables ?? true),
            includeCells: Boolean(args.includeCells ?? true)
          }
        })
        if (!workerResponse.ok) {
          const out = runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
          runtime.input.emitActivity({
            actionType: 'docx_outline',
            status: 'failed',
            summary: out.summary
          })
          return out
        }
        if (workerResponse.payload.action !== 'outline') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (outline)'
          })
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `outline ready (${workerResponse.payload.blocks.length} blocks)`,
          blocks: workerResponse.payload.blocks,
          truncated: workerResponse.payload.truncated
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_outline',
      description:
        'Extract a deterministic block outline for a previously opened doc (paragraph/table/table_cell).',
      schema: outlineSchema
    }
  )

  const docxGetBlockTool = tool(
    async (args) => {
      const toolName = 'docx_get_block'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const workerResponse = await runtime.callWorker({
          action: 'get_block',
          payload: {
            docId,
            blockId: args.blockId
          }
        })
        if (!workerResponse.ok) {
          return runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
        }
        if (workerResponse.payload.action !== 'get_block') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (get_block)'
          })
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `block loaded: ${args.blockId}`,
          block: workerResponse.payload.block
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_get_block',
      description: 'Get one block by blockId with detailed structure.',
      schema: getBlockSchema
    }
  )

  const docxSearchTool = tool(
    async (args) => {
      const toolName = 'docx_search'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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

        const workerResponse = await runtime.callWorker({
          action: 'search',
          payload: {
            docId,
            query: args.query,
            mode: args.mode,
            scopeBlockIds: args.scope?.blockIds || []
          }
        })
        if (!workerResponse.ok) {
          return runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
        }
        if (workerResponse.payload.action !== 'search') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (search)'
          })
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `search done (${workerResponse.payload.matches.length} matches)`,
          matches: workerResponse.payload.matches,
          warnings: workerResponse.payload.warnings
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_search',
      description:
        'Search blocks in a doc using literal/regex mode, or semantic block retrieval with cached embeddings.',
      schema: searchSchema
    }
  )

  const docxGetHistoryTool = tool(
    async (args) => {
      const toolName = 'docx_get_history'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_get_history',
      description:
        'Inspect the immutable docx snapshot lineage for the current run. Useful for confirm/rollback flows before save.',
      schema: historySchema
    }
  )

  return [
    docxOpenTool,
    docxOutlineTool,
    docxGetBlockTool,
    docxSearchTool,
    docxGetHistoryTool
  ]
}

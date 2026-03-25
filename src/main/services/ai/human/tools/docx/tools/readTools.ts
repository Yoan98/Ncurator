import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type { DocxOutlineBlock } from '../types'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'
import {
  DOCX_GET_BLOCK_TOOL_SPEC,
  DOCX_GET_HISTORY_TOOL_SPEC,
  DOCX_OPEN_TOOL_SPEC,
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolSuccess,
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
    name: DOCX_OPEN_TOOL_SPEC.name,
    description: DOCX_OPEN_TOOL_SPEC.description,
    schema: DOCX_OPEN_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_OPEN_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `文档打开异常: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const requestedSourcePath = runtime.resolveDocxPath({
        cwd: runtime.workspaceRootPath,
        rawPath: args.sourcePath
      })
      if (!requestedSourcePath) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'sourcePath must be a workspace-bound .docx path'
        })
      }
      if (!fs.existsSync(requestedSourcePath)) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'sourcePath not found'
        })
      }

      const resolvedTarget = await runtime.input.ctx.resolveDocxOpenTarget(requestedSourcePath)
      const openPath = resolvedTarget.openPath
      if (!fs.existsSync(openPath)) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'effective docx path not found'
        })
      }

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_OPEN_TOOL_SPEC.workerAction!,
        activity: {
          actionType: DOCX_OPEN_TOOL_SPEC.activityActionType!,
          startedSummary: `打开文档: ${requestedSourcePath}`,
          buildCompletedSummary: () => `文档已打开: ${path.basename(requestedSourcePath)}`,
          buildFailedSummary: (failure) => `文档打开失败: ${failure.error}`
        },
        request: {
          action: DOCX_OPEN_TOOL_SPEC.workerAction!,
          payload: {
            sourcePath: openPath
          }
        },
        buildSuccess: (workerPayload) => {
          runtime.state.lastDocId = workerPayload.docId
          runtime.state.sourcePathByDocId.set(
            workerPayload.docId,
            resolvedTarget.trackedSourcePath
          )
          runtime.registerSnapshot(workerPayload.docId)
          runtime.input.ctx.trackDocxOpen({
            docId: workerPayload.docId,
            sourcePath: resolvedTarget.trackedSourcePath
          })
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `doc opened: ${path.basename(requestedSourcePath)}`,
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
    name: DOCX_OUTLINE_TOOL_SPEC.name,
    description: DOCX_OUTLINE_TOOL_SPEC.description,
    schema: DOCX_OUTLINE_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId, docId }) => {
      runtime.input.ctx.checkCancelled()
      return await runDocxWorkerToolAction<'outline', DocxOutlineResult>({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_OUTLINE_TOOL_SPEC.workerAction!,
        draftDocId: docId,
        activity: {
          actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
          startedSummary: `提取结构: ${docId}`,
          buildCompletedSummary: (result) => `结构提取完成: ${String(result.blocks.length)} blocks`
        },
        request: {
          action: DOCX_OUTLINE_TOOL_SPEC.workerAction!,
          payload: {
            docId,
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
            draftDocId: docId
          }
        }
      })
    },
  })

  const docxGetBlockTool = createDocxTool({
    runtime,
    name: DOCX_GET_BLOCK_TOOL_SPEC.name,
    description: DOCX_GET_BLOCK_TOOL_SPEC.description,
    schema: DOCX_GET_BLOCK_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_GET_BLOCK_TOOL_SPEC.workerAction!,
        request: {
          action: DOCX_GET_BLOCK_TOOL_SPEC.workerAction!,
          payload: {
            docId,
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
            draftDocId: docId
          }
        }
      })
    },
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: DOCX_SEARCH_TOOL_SPEC.name,
    description: DOCX_SEARCH_TOOL_SPEC.description,
    schema: DOCX_SEARCH_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
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
          draftDocId: docId
        })
      }

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_SEARCH_TOOL_SPEC.workerAction!,
        request: {
          action: DOCX_SEARCH_TOOL_SPEC.workerAction!,
          payload: {
            docId,
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
            draftDocId: docId
          }
        }
      })
    },
  })

  const docxGetHistoryTool = createDocxTool({
    runtime,
    name: DOCX_GET_HISTORY_TOOL_SPEC.name,
    description: DOCX_GET_HISTORY_TOOL_SPEC.description,
    schema: DOCX_GET_HISTORY_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
      const history = runtime.buildSnapshotHistory(docId, Number(args.maxDepth || 10))
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
        currentDocId: docId,
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
        draftDocId: docId
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

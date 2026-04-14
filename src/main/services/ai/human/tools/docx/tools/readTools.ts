import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type { DocxOutlineBlock } from '../types'
import { clipText } from '../../../../utils/text'
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
    sourcePath: string
    currentVersionRef: string
    blocks: DocxOutlineBlock[]
    truncated: boolean
    resourceContext: ReturnType<DocxToolRuntime['buildResourceContext']>
  }

  const buildOutlineSummary = (input: { blockCount: number; truncated: boolean }): string =>
    input.truncated
      ? `返回 ${String(input.blockCount)} 个结构块（结果已截断，文档后续内容未包含）`
      : `返回 ${String(input.blockCount)} 个结构块`

  const buildDetailedBlockPreview = (
    block: {
      type: 'paragraph' | 'table' | 'table_cell'
      text?: string
      preview?: string
      blockId: string
    }
  ): string => {
    const previewText = String(block.text || block.preview || '').trim()
    return previewText ? clipText(previewText, runtime.input.safePreviewChars) : block.blockId
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

      const existingSession = runtime.getDocumentSession(requestedSourcePath)
      if (existingSession) {
        const resourceContext = runtime.buildResourceContext({
          sourcePath: requestedSourcePath,
          effectKind: 'opened',
          currentVersionRef: existingSession.activeVersionRef
        })
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `doc session reused: ${path.basename(requestedSourcePath)}`,
          sourcePath: requestedSourcePath,
          currentVersionRef: existingSession.activeVersionRef,
          meta: existingSession.meta,
          stats: existingSession.stats,
          resourceContext
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: true,
            code: 'ok',
            summary: result.summary,
            sourcePath: result.sourcePath,
            currentVersionRef: result.currentVersionRef
          },
          draftDocId: existingSession.activeDocId,
          activity: {
            actionType: DOCX_OPEN_TOOL_SPEC.activityActionType!,
            startedSummary: `打开文档: ${requestedSourcePath}`,
            buildCompletedSummary: () => `文档会话已复用: ${path.basename(requestedSourcePath)}`
          }
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
          const { currentVersionRef } = runtime.registerOpenedDocument(
            resolvedTarget.trackedSourcePath,
            workerPayload.docId,
            workerPayload.meta,
            workerPayload.stats
          )
          runtime.input.ctx.trackDocxOpen({
            docId: workerPayload.docId,
            sourcePath: resolvedTarget.trackedSourcePath
          })
          const resourceContext = runtime.buildResourceContext({
            sourcePath: resolvedTarget.trackedSourcePath,
            effectKind: 'opened',
            currentVersionRef
          })
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `doc opened: ${path.basename(requestedSourcePath)}`,
            sourcePath: resolvedTarget.trackedSourcePath,
            currentVersionRef,
            meta: workerPayload.meta,
            stats: workerPayload.stats,
            resourceContext
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              sourcePath: result.sourcePath,
              currentVersionRef: result.currentVersionRef
            },
            draftDocId: workerPayload.docId
          }
        }
      })
    }
  })

  const docxOutlineTool = createDocxTool({
    runtime,
    name: DOCX_OUTLINE_TOOL_SPEC.name,
    description: DOCX_OUTLINE_TOOL_SPEC.description,
    schema: DOCX_OUTLINE_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = runtime.requireDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure
      return await runDocxWorkerToolAction<'outline', DocxOutlineResult>({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_OUTLINE_TOOL_SPEC.workerAction!,
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
          startedSummary: `提取结构: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (result) =>
            `结构提取完成：${buildOutlineSummary({
              blockCount: result.blocks.length,
              truncated: result.truncated
            })}`
        },
        request: {
          action: DOCX_OUTLINE_TOOL_SPEC.workerAction!,
          payload: {
            docId: sessionResult.docId,
            maxBlocks: Number(args.maxBlocks || 200),
            includeTables: Boolean(args.includeTables ?? true),
            includeCells: Boolean(args.includeCells ?? true)
          }
        },
        buildSuccess: (workerPayload) => {
          const resourceContext = runtime.buildResourceContext({
            sourcePath: sessionResult.sourcePath,
            effectKind: 'read',
            currentVersionRef: sessionResult.currentVersionRef
          })
          const result: DocxOutlineResult = {
            ok: true,
            code: 'ok',
            summary: buildOutlineSummary({
              blockCount: workerPayload.blocks.length,
              truncated: workerPayload.truncated
            }),
            sourcePath: sessionResult.sourcePath,
            currentVersionRef: sessionResult.currentVersionRef,
            blocks: workerPayload.blocks,
            truncated: workerPayload.truncated,
            resourceContext
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              sourcePath: result.sourcePath,
              currentVersionRef: result.currentVersionRef,
              blockCount: result.blocks.length,
              truncated: result.truncated
            },
            draftDocId: sessionResult.docId
          }
        }
      })
    }
  })

  const docxGetBlockTool = createDocxTool({
    runtime,
    name: DOCX_GET_BLOCK_TOOL_SPEC.name,
    description: DOCX_GET_BLOCK_TOOL_SPEC.description,
    schema: DOCX_GET_BLOCK_TOOL_SPEC.schema,
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = runtime.requireDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure
      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_GET_BLOCK_TOOL_SPEC.workerAction!,
        draftDocId: sessionResult.docId,
        request: {
          action: DOCX_GET_BLOCK_TOOL_SPEC.workerAction!,
          payload: {
            docId: sessionResult.docId,
            blockId: args.blockId
          }
        },
        buildSuccess: (workerPayload) => {
          const blockPreview = buildDetailedBlockPreview(workerPayload.block)
          const resourceContext = runtime.buildResourceContext({
            sourcePath: sessionResult.sourcePath,
            effectKind: 'read',
            currentVersionRef: sessionResult.currentVersionRef
          })
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `block loaded: ${args.blockId}`,
            sourcePath: sessionResult.sourcePath,
            currentVersionRef: sessionResult.currentVersionRef,
            block: workerPayload.block,
            resourceContext
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              sourcePath: result.sourcePath,
              currentVersionRef: result.currentVersionRef,
              blockId: result.block.blockId,
              blockType: result.block.type,
              bodyIndex: result.block.bodyIndex,
              previousBodyBlockId: result.block.previousBodyBlockId,
              nextBodyBlockId: result.block.nextBodyBlockId,
              text: blockPreview
            },
            draftDocId: sessionResult.docId
          }
        }
      })
    }
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: DOCX_SEARCH_TOOL_SPEC.name,
    description: DOCX_SEARCH_TOOL_SPEC.description,
    schema: DOCX_SEARCH_TOOL_SPEC.schema,
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = runtime.requireDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      if (args.mode === 'semantic') {
        if (runtime.input.ctx.embeddingService.getStatus() !== 'ready') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'semantic search requires embedding runtime to be ready before entering human',
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'searched',
              currentVersionRef: sessionResult.currentVersionRef
            })
          })
        }
        const semanticIndex = await runtime.buildSemanticDocIndex(sessionResult.docId)
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
            error: 'semantic query embedding is empty',
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'searched',
              currentVersionRef: sessionResult.currentVersionRef
            })
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
        const resourceContext = runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'searched',
          currentVersionRef: sessionResult.currentVersionRef
        })
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `semantic search done (${matches.length} matches)`,
          sourcePath: sessionResult.sourcePath,
          currentVersionRef: sessionResult.currentVersionRef,
          matches,
          warnings,
          resourceContext
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
            sourcePath: result.sourcePath,
            currentVersionRef: result.currentVersionRef,
            matchCount: result.matches.length,
            firstMatchBlockType: result.matches[0]?.blockType,
            firstMatchBodyIndex: result.matches[0]?.bodyIndex,
            warnings: result.warnings
          },
          draftDocId: sessionResult.docId
        })
      }

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_SEARCH_TOOL_SPEC.workerAction!,
        draftDocId: sessionResult.docId,
        request: {
          action: DOCX_SEARCH_TOOL_SPEC.workerAction!,
          payload: {
            docId: sessionResult.docId,
            query: args.query,
            mode: args.mode,
            scopeBlockIds: args.scope?.blockIds || []
          }
        },
        buildSuccess: (workerPayload) => {
          const resourceContext = runtime.buildResourceContext({
            sourcePath: sessionResult.sourcePath,
            effectKind: 'searched',
            currentVersionRef: sessionResult.currentVersionRef
          })
          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `search done (${workerPayload.matches.length} matches)`,
            sourcePath: sessionResult.sourcePath,
            currentVersionRef: sessionResult.currentVersionRef,
            matches: workerPayload.matches,
            warnings: workerPayload.warnings,
            resourceContext
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              sourcePath: result.sourcePath,
              currentVersionRef: result.currentVersionRef,
              matchCount: result.matches.length,
              firstMatchBlockType: result.matches[0]?.blockType,
              firstMatchBodyIndex: result.matches[0]?.bodyIndex,
              warnings: result.warnings
            },
            draftDocId: sessionResult.docId
          }
        }
      })
    }
  })

  const docxGetHistoryTool = createDocxTool({
    runtime,
    name: DOCX_GET_HISTORY_TOOL_SPEC.name,
    description: DOCX_GET_HISTORY_TOOL_SPEC.description,
    schema: DOCX_GET_HISTORY_TOOL_SPEC.schema,
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = runtime.requireDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure
      const history = runtime.buildVersionHistory(sessionResult.sourcePath, Number(args.maxDepth || 10))
      if (history.length === 0) {
        return runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'invalid_input',
          error: 'sourcePath is not tracked in current docx version history',
          resourceContext: runtime.buildResourceContext({
            sourcePath: sessionResult.sourcePath,
            effectKind: 'history',
            currentVersionRef: sessionResult.currentVersionRef
          })
        })
      }

      const resourceContext = runtime.buildResourceContext({
        sourcePath: sessionResult.sourcePath,
        effectKind: 'history',
        currentVersionRef: sessionResult.currentVersionRef
      })
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `version history loaded (${history.length} items)`,
        sourcePath: sessionResult.sourcePath,
        currentVersionRef: sessionResult.currentVersionRef,
        versions: history.map((entry) => ({
          versionRef: entry.versionRef,
          parentVersionRef: entry.parentVersionRef,
          createdAt: entry.createdAt,
          isCurrent: entry.isCurrent
        })),
        resourceContext
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
          sourcePath: result.sourcePath,
          currentVersionRef: result.currentVersionRef,
          versionCount: result.versions.length
        },
        draftDocId: sessionResult.docId
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

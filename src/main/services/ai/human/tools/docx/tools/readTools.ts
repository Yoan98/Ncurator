import type { StructuredToolInterface } from '@langchain/core/tools'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'
import type { DocxToolRuntime } from '../runtime'
import type { DocxDetailedBlock, DocxOutlineBlock, DocxReadSession, DocxSearchMatch } from '../types'
import {
  DOCX_HISTORY_TOOL_SPEC,
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess
} from './workerTool'

const DEFAULT_OUTLINE_BLOCKS = 200
const MAX_SEARCH_MATCHES = 20
const SEMANTIC_TOP_K = 8
const SEMANTIC_MIN_SCORE = 0.35

const DOCX_LITERAL_ALIAS_FALLBACKS: Record<string, string[]> = {
  过拟合: ['过度拟合']
}

type AppliedAlias = {
  from: string
  to: string
}

const headingLevelFromStyle = (style: string | undefined): number | undefined => {
  const normalized = String(style || '').trim()
  if (!normalized) return undefined
  const match = normalized.match(/^heading\s*([1-6])$/i) || normalized.match(/^Heading([1-6])$/)
  return match ? Number(match[1]) : undefined
}

const buildOutlineBlock = (block: DocxOutlineBlock) => {
  if (block.type === 'paragraph') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      layoutMode: block.layoutMode,
      previousBodyBlockId: block.previousBodyBlockId,
      nextBodyBlockId: block.nextBodyBlockId,
      style: block.style,
      headingLevel: headingLevelFromStyle(block.style),
      preview: block.text
    }
  }
  if (block.type === 'table') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      layoutMode: block.layoutMode,
      previousBodyBlockId: block.previousBodyBlockId,
      nextBodyBlockId: block.nextBodyBlockId,
      rows: block.rows,
      cols: block.cols,
      preview: block.preview
    }
  }
  return {
    blockId: block.blockId,
    type: block.type,
    bodyIndex: block.bodyIndex,
    layoutMode: block.layoutMode,
    previousBodyBlockId: block.previousBodyBlockId,
    nextBodyBlockId: block.nextBodyBlockId,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    preview: block.text
  }
}

const buildReadBlock = (block: DocxDetailedBlock) => {
  if (block.type === 'paragraph') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      layoutMode: block.layoutMode,
      previousBodyBlockId: block.previousBodyBlockId,
      nextBodyBlockId: block.nextBodyBlockId,
      style: block.style,
      headingLevel: headingLevelFromStyle(block.style),
      text: block.text,
      runs: block.runs
    }
  }
  if (block.type === 'table') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      layoutMode: block.layoutMode,
      previousBodyBlockId: block.previousBodyBlockId,
      nextBodyBlockId: block.nextBodyBlockId,
      rows: block.rows,
      cols: block.cols,
      preview: block.preview,
      cells: block.cells
    }
  }
  return {
    blockId: block.blockId,
    type: block.type,
    bodyIndex: block.bodyIndex,
    layoutMode: block.layoutMode,
    previousBodyBlockId: block.previousBodyBlockId,
    nextBodyBlockId: block.nextBodyBlockId,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    text: block.text,
    paragraphs: block.paragraphs
  }
}

const buildOutlineCacheKey = (input: {
  fromBodyIndex: number
  maxBlocks: number
  includeTables: boolean
  includeCells: boolean
}): string =>
  `${String(input.fromBodyIndex)}:${String(input.maxBlocks)}:${input.includeTables ? '1' : '0'}:${input.includeCells ? '1' : '0'}`

const fetchOutline = async (input: {
  runtime: DocxToolRuntime
  session?: DocxReadSession
  docId: string
  fromBodyIndex: number
  maxBlocks: number
  includeTables: boolean
  includeCells: boolean
}) => {
  const cacheKey = buildOutlineCacheKey({
    fromBodyIndex: input.fromBodyIndex,
    maxBlocks: input.maxBlocks,
    includeTables: input.includeTables,
    includeCells: input.includeCells
  })
  const cached = input.session?.cache.outlineByCacheKey.get(cacheKey)
  if (cached) return cached
  const outlineResponse = await input.runtime.callWorker({
    action: 'outline',
    payload: {
      docId: input.docId,
      fromBodyIndex: input.fromBodyIndex,
      maxBlocks: input.maxBlocks,
      includeTables: input.includeTables,
      includeCells: input.includeCells
    }
  })
  if (!outlineResponse.ok) {
    throw new Error(outlineResponse.error)
  }
  if (outlineResponse.payload.action !== 'outline') {
    throw new Error('worker protocol mismatch (outline)')
  }
  const result = {
    blocks: outlineResponse.payload.blocks,
    truncated: outlineResponse.payload.truncated
  }
  input.session?.cache.outlineByCacheKey.set(cacheKey, result)
  return result
}

const fetchBlocksByRange = async (input: {
  runtime: DocxToolRuntime
  session?: DocxReadSession
  docId: string
  fromBlockId: string
  toBlockId: string
}) => {
  const cached =
    input.session &&
    input.fromBlockId === input.toBlockId &&
    input.session.cache.detailByBlockId.get(input.fromBlockId)
  if (cached) {
    return [cached]
  }
  const blockResponse = await input.runtime.callWorker({
    action: 'get_blocks_by_range',
    payload: {
      docId: input.docId,
      fromBlockId: input.fromBlockId,
      toBlockId: input.toBlockId
    }
  })
  if (!blockResponse.ok) {
    throw new Error(blockResponse.error)
  }
  if (blockResponse.payload.action !== 'get_blocks_by_range') {
    throw new Error('worker protocol mismatch (get_blocks_by_range)')
  }
  blockResponse.payload.blocks.forEach((block) => {
    input.session?.cache.detailByBlockId.set(block.blockId, block)
  })
  return blockResponse.payload.blocks
}

const executeWorkerSearch = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  docId: string
  query: string
  mode: 'literal' | 'regex'
  scopeBlockIds: string[]
  sourcePath: string
  currentRevisionRef: string
}): Promise<
  | {
      failure: ReturnType<DocxToolRuntime['emitFailure']>
    }
  | {
      matches: DocxSearchMatch[]
      warnings: string[]
    }
> => {
  const workerResponse = await input.runtime.callWorker({
    action: 'search',
    payload: {
      docId: input.docId,
      query: input.query,
      mode: input.mode,
      scopeBlockIds: input.scopeBlockIds
    }
  })
  if (!workerResponse.ok) {
    return {
      failure: input.runtime.emitWorkerFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        response: workerResponse,
        draftDocId: input.docId,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'searched',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }
  if (workerResponse.payload.action !== 'search') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        code: 'failed',
        error: 'worker protocol mismatch (search)',
        draftDocId: input.docId,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'searched',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }
  return {
    matches: workerResponse.payload.matches,
    warnings: workerResponse.payload.warnings
  }
}

const buildLiteralSearchAttempts = (query: string): Array<{ query: string; appliedAliases: AppliedAlias[] }> => {
  const normalizedQuery = query.trim()
  const aliases = DOCX_LITERAL_ALIAS_FALLBACKS[normalizedQuery] || []
  return [
    {
      query: normalizedQuery,
      appliedAliases: []
    },
    ...aliases.map((alias) => ({
      query: alias,
      appliedAliases: [{ from: normalizedQuery, to: alias }]
    }))
  ]
}

const buildSearchResult = (input: {
  sourcePath: string
  currentRevisionRef: string
  mode: 'literal' | 'regex' | 'semantic'
  effectiveQuery: string
  appliedAliases: AppliedAlias[]
  totalMatchCount: number
  matches: DocxSearchMatch[]
  warnings: string[]
  runtime: DocxToolRuntime
}) => ({
  ok: true,
  code: 'ok' as const,
  summary: `返回 ${String(input.matches.length)} 个搜索命中`,
  sourcePath: input.sourcePath,
  currentRevisionRef: input.currentRevisionRef,
  mode: input.mode,
  effectiveQuery: input.effectiveQuery,
  appliedAliases: input.appliedAliases,
  totalMatchCount: input.totalMatchCount,
  returnedMatchCount: input.matches.length,
  truncated: input.totalMatchCount > input.matches.length,
  matches: input.matches,
  warnings: input.warnings,
  resourceContext: input.runtime.buildResourceContext({
    sourcePath: input.sourcePath,
    effectKind: 'searched',
    currentRevisionRef: input.currentRevisionRef
  })
})

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
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
      const sessionResult = await runtime.ensureReadSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const fromBodyIndex = Math.max(0, Number(args.fromBodyIndex || 0))
      const maxBlocks = Number(args.maxBlocks || DEFAULT_OUTLINE_BLOCKS)
      let outlineResult: { blocks: DocxOutlineBlock[]; truncated: boolean }
      try {
        outlineResult = await fetchOutline({
          runtime,
          session: sessionResult.readSession,
          docId: sessionResult.docId,
          fromBodyIndex,
          maxBlocks,
          includeTables: true,
          includeCells: true
        })
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: error instanceof Error ? error.message : String(error),
            draftDocId: sessionResult.docId,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'read',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `返回 ${String(outlineResult.blocks.length)} 个结构块`,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        fromBodyIndex,
        returnedBlockCount: outlineResult.blocks.length,
        totalBlockCount: sessionResult.stats.blockCount,
        truncated: outlineResult.truncated,
        blocks: outlineResult.blocks.map(buildOutlineBlock),
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'read',
          currentRevisionRef: sessionResult.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          currentRevisionRef: result.currentRevisionRef,
          fromBodyIndex: result.fromBodyIndex,
          returnedBlockCount: result.returnedBlockCount,
          totalBlockCount: result.totalBlockCount,
          truncated: result.truncated
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
          startedSummary: `提取结构: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `结构提取完成：${String(output.returnedBlockCount)} 个块`
        }
      })
    }
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: DOCX_SEARCH_TOOL_SPEC.name,
    description: DOCX_SEARCH_TOOL_SPEC.description,
    schema: DOCX_SEARCH_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureReadSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const mode = args.mode || 'literal'
      const scopeBlockIds = args.scope?.blockIds || []

      if (mode === 'semantic') {
        if (runtime.input.ctx.embeddingService.getStatus() !== 'ready') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'semantic search requires embedding runtime to be ready before entering human',
              draftDocId: sessionResult.docId,
              resourceContext: runtime.buildResourceContext({
                sourcePath: sessionResult.sourcePath,
                effectKind: 'searched',
                currentRevisionRef: sessionResult.currentRevisionRef
              })
            }),
            activity: {
              actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!
            }
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
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'semantic query embedding is empty',
              draftDocId: sessionResult.docId,
              resourceContext: runtime.buildResourceContext({
                sourcePath: sessionResult.sourcePath,
                effectKind: 'searched',
                currentRevisionRef: sessionResult.currentRevisionRef
              })
            }),
            activity: {
              actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!
            }
          })
        }

        const allMatches = buildSemanticMatches({
          entries: semanticIndex.entries,
          queryEmbedding,
          scopeBlockIds,
          queryText: args.query,
          topK: SEMANTIC_TOP_K,
          minScore: SEMANTIC_MIN_SCORE
        })
        const matches = allMatches.slice(0, MAX_SEARCH_MATCHES)
        const warnings =
          semanticIndex.entries.length === 0
            ? ['no searchable paragraph or table cell blocks found for semantic search']
            : []
        const result = buildSearchResult({
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          mode,
          effectiveQuery: args.query,
          appliedAliases: [],
          totalMatchCount: allMatches.length,
          matches,
          warnings,
          runtime
        })
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: true,
            code: 'ok',
            sourcePath: result.sourcePath,
            currentRevisionRef: result.currentRevisionRef,
            mode: result.mode,
            effectiveQuery: result.effectiveQuery,
            returnedMatchCount: result.returnedMatchCount,
            totalMatchCount: result.totalMatchCount,
            truncated: result.truncated
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!,
            startedSummary: `搜索文档: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `文档搜索完成：${String(output.returnedMatchCount)} 个命中`
          }
        })
      }

      const attempts =
        mode === 'literal'
          ? buildLiteralSearchAttempts(args.query)
          : [{ query: args.query, appliedAliases: [] }]
      let effectiveQuery = args.query
      let appliedAliases: AppliedAlias[] = []
      let allMatches: DocxSearchMatch[] = []
      let warnings: string[] = []

      for (const attempt of attempts) {
        const searchResult = await executeWorkerSearch({
          runtime,
          toolName,
          toolCallId,
          docId: sessionResult.docId,
          query: attempt.query,
          mode,
          scopeBlockIds,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef
        })
        if ('failure' in searchResult) {
          return finalizeDocxToolFailure({
            runtime,
            failure: searchResult.failure,
            activity: {
              actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!
            }
          })
        }
        allMatches = searchResult.matches
        warnings = searchResult.warnings
        effectiveQuery = attempt.query
        appliedAliases = attempt.appliedAliases
        if (allMatches.length > 0 || mode !== 'literal') {
          break
        }
      }

      const matches = allMatches.slice(0, MAX_SEARCH_MATCHES)
      const result = buildSearchResult({
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        mode,
        effectiveQuery,
        appliedAliases,
        totalMatchCount: allMatches.length,
        matches,
        warnings,
        runtime
      })
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          currentRevisionRef: result.currentRevisionRef,
          mode: result.mode,
          effectiveQuery: result.effectiveQuery,
          returnedMatchCount: result.returnedMatchCount,
          totalMatchCount: result.totalMatchCount,
          truncated: result.truncated
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType!,
          startedSummary: `搜索文档: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `文档搜索完成：${String(output.returnedMatchCount)} 个命中`
        }
      })
    }
  })

  const docxReadTool = createDocxTool({
    runtime,
    name: DOCX_READ_TOOL_SPEC.name,
    description: DOCX_READ_TOOL_SPEC.description,
    schema: DOCX_READ_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_READ_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureReadSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      try {
        const blocks = await fetchBlocksByRange({
          runtime,
          session: sessionResult.readSession,
          docId: sessionResult.docId,
          fromBlockId: args.fromBlockId.trim(),
          toBlockId: (args.toBlockId || args.fromBlockId).trim()
        })
        const fromBlockId = args.fromBlockId.trim()
        const toBlockId = (args.toBlockId || args.fromBlockId).trim()
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `返回 ${String(blocks.length)} 个连续块`,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          fromBlockId,
          toBlockId,
          returnedBlockCount: blocks.length,
          blocks: blocks.map(buildReadBlock),
          resourceContext: runtime.buildResourceContext({
            sourcePath: sessionResult.sourcePath,
            effectKind: 'read',
            currentRevisionRef: sessionResult.currentRevisionRef
          })
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: true,
            code: 'ok',
            sourcePath: result.sourcePath,
            currentRevisionRef: result.currentRevisionRef,
            fromBlockId: result.fromBlockId,
            toBlockId: result.toBlockId,
            returnedBlockCount: result.returnedBlockCount
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_TOOL_SPEC.activityActionType!,
            startedSummary: `精读文档区间: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `文档精读完成：${String(output.returnedBlockCount)} 个块`
          }
        })
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: error instanceof Error ? error.message : String(error),
            draftDocId: sessionResult.docId,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'read',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_READ_TOOL_SPEC.activityActionType!
          }
        })
      }
    }
  })

  const docxHistoryTool = createDocxTool({
    runtime,
    name: DOCX_HISTORY_TOOL_SPEC.name,
    description: DOCX_HISTORY_TOOL_SPEC.description,
    schema: DOCX_HISTORY_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_HISTORY_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const revisions = runtime.buildRevisionHistory(
        sessionResult.sourcePath,
        Math.max(1, Number(args.limit || 10))
      )
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `返回 ${String(revisions.length)} 个修订`,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        revisions: revisions.map((revision) => ({
          revisionRef: revision.revisionRef,
          parentRevisionRef: revision.parentRevisionRef,
          createdAt: revision.createdAt,
          isCurrent: revision.isCurrent,
          summary: revision.summary || '',
          changedBlocks: revision.changedBlocks || []
        })),
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'history',
          currentRevisionRef: sessionResult.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          currentRevisionRef: result.currentRevisionRef,
          revisionCount: result.revisions.length
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_HISTORY_TOOL_SPEC.activityActionType!,
          startedSummary: `查看修订历史: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `修订历史返回 ${String(output.revisions.length)} 项`
        }
      })
    }
  })

  return [docxOutlineTool, docxSearchTool, docxReadTool, docxHistoryTool]
}

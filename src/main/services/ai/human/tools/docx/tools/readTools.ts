import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../../../shared/types'
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
      blockIndex: block.blockIndex,
      layoutMode: block.layoutMode,
      previousBlockId: block.previousBlockId,
      nextBlockId: block.nextBlockId,
      style: block.style,
      headingLevel: headingLevelFromStyle(block.style),
      text: block.text
    }
  }
  if (block.type === 'table') {
    return {
      blockId: block.blockId,
      type: block.type,
      blockIndex: block.blockIndex,
      layoutMode: block.layoutMode,
      previousBlockId: block.previousBlockId,
      nextBlockId: block.nextBlockId,
      rows: block.rows,
      cols: block.cols,
      text: block.text
    }
  }
  return {
    blockId: block.blockId,
    type: block.type,
    blockIndex: block.blockIndex,
    layoutMode: block.layoutMode,
    previousBlockId: block.previousBlockId,
    nextBlockId: block.nextBlockId,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    text: block.text
  }
}

const buildReadBlock = (block: DocxDetailedBlock) => {
  if (block.type === 'paragraph') {
    return {
      blockId: block.blockId,
      type: block.type,
      blockIndex: block.blockIndex,
      layoutMode: block.layoutMode,
      previousBlockId: block.previousBlockId,
      nextBlockId: block.nextBlockId,
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
      blockIndex: block.blockIndex,
      layoutMode: block.layoutMode,
      previousBlockId: block.previousBlockId,
      nextBlockId: block.nextBlockId,
      rows: block.rows,
      cols: block.cols,
      text: block.text,
      cells: block.cells
    }
  }
  return {
    blockId: block.blockId,
    type: block.type,
    blockIndex: block.blockIndex,
    layoutMode: block.layoutMode,
    previousBlockId: block.previousBlockId,
    nextBlockId: block.nextBlockId,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    text: block.text,
    paragraphs: block.paragraphs
  }
}

const fetchBlocksByBlockIds = async (input: {
  runtime: DocxToolRuntime
  session?: DocxReadSession
  docId: string
  blockIds: string[]
}) => {
  const uniqueBlockIds = [...new Set(input.blockIds)]
  if (uniqueBlockIds.length === 1) {
    const cached = input.session?.cache.detailByBlockId.get(uniqueBlockIds[0]!)
    if (cached) return [cached]
  }
  const blockResponse = await input.runtime.callWorker({
    action: 'get_blocks_by_ids',
    payload: {
      docId: input.docId,
      blockIds: uniqueBlockIds
    }
  })
  if (!blockResponse.ok) {
    throw new Error(blockResponse.error)
  }
  if (blockResponse.payload.action !== 'get_blocks_by_ids') {
    throw new Error('worker protocol mismatch (get_blocks_by_ids)')
  }
  blockResponse.payload.blocks.forEach((block) => {
    input.session?.cache.detailByBlockId.set(block.blockId, block)
  })
  return blockResponse.payload.blocks
}

const fetchBlocksByBlockIndexRange = async (input: {
  runtime: DocxToolRuntime
  docId: string
  fromBlockIndex: number
  toBlockIndex: number
}) => {
  const blockResponse = await input.runtime.callWorker({
    action: 'get_blocks_by_block_index_range',
    payload: {
      docId: input.docId,
      fromBlockIndex: input.fromBlockIndex,
      toBlockIndex: input.toBlockIndex
    }
  })
  if (!blockResponse.ok) {
    throw new Error(blockResponse.error)
  }
  if (blockResponse.payload.action !== 'get_blocks_by_block_index_range') {
    throw new Error('worker protocol mismatch (get_blocks_by_block_index_range)')
  }
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
  matches: input.matches,
  warnings: input.warnings,
  resourceContext: input.runtime.buildResourceContext({
    sourcePath: input.sourcePath,
    effectKind: 'searched',
    currentRevisionRef: input.currentRevisionRef
  })
})

const buildSearchOutputPreview = (result: ReturnType<typeof buildSearchResult>) => ({
  ok: true,
  code: 'ok',
  sourcePath: result.sourcePath,
  currentRevisionRef: result.currentRevisionRef,
  mode: result.mode,
  effectiveQuery: result.effectiveQuery,
  returnedMatchCount: result.returnedMatchCount,
  totalMatchCount: result.totalMatchCount
})

const DOCX_AI_RESULT_CONTEXT_WINDOW_RATIO = 0.1

const estimateDocxResultTokens = (value: unknown): number =>
  Math.ceil(JSON.stringify(value).length / 4)

const getDocxAiResultTokenLimit = (runtime: DocxToolRuntime): number => {
  const contextWindowTokens = runtime.input.modelContextWindowTokens
  return Math.max(1, Math.floor(contextWindowTokens * DOCX_AI_RESULT_CONTEXT_WINDOW_RATIO))
}

const buildResultTooLargeFailure = (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  totalBlockCount: number
  estimatedTokens: number
  suggestedRanges: Array<
    | { type: 'percent'; fromPercent: number; toPercent: number }
    | { type: 'block_index'; fromBlockIndex: number; toBlockIndex: number }
  >
}) =>
  input.runtime.emitFailure({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    code: 'result_too_large',
    error: 'docx result too large',
    warnings: [],
    decisionHint: {
      sourcePath: input.sourcePath,
      toolName: input.toolName,
      totalBlockCount: input.totalBlockCount,
      estimatedTokens: input.estimatedTokens,
      limit: getDocxAiResultTokenLimit(input.runtime),
      suggestedRanges: input.suggestedRanges
    } as JsonObject,
    resourceContext: input.runtime.buildResourceContext({
      sourcePath: input.sourcePath,
      effectKind: 'read',
      currentRevisionRef: input.currentRevisionRef
    })
  })

const toOutlineRange = (
  range: { type: 'percent'; fromPercent: number; toPercent: number } | { type: 'block_index'; fromBlockIndex: number; toBlockIndex: number },
  totalBlockCount: number
): { fromBlockIndex: number; toBlockIndex: number } => {
  if (range.type === 'block_index') {
    return {
      fromBlockIndex: Math.max(0, Math.min(range.fromBlockIndex, range.toBlockIndex)),
      toBlockIndex: Math.max(0, Math.max(range.fromBlockIndex, range.toBlockIndex))
    }
  }
  const fromPercent = Math.max(0, Math.min(100, range.fromPercent))
  const toPercent = Math.max(0, Math.min(100, range.toPercent))
  const fromBlockIndex = Math.max(0, Math.floor((Math.min(fromPercent, toPercent) / 100) * totalBlockCount))
  const toBlockIndex = Math.max(
    0,
    Math.ceil((Math.max(fromPercent, toPercent) / 100) * totalBlockCount) - 1
  )
  return {
    fromBlockIndex,
    toBlockIndex
  }
}

const mergeOutlineRanges = (
  ranges: Array<{ fromBlockIndex: number; toBlockIndex: number }>
): Array<{ fromBlockIndex: number; toBlockIndex: number }> => {
  const normalized = ranges
    .map((range) => ({
      fromBlockIndex: Math.max(0, Math.min(range.fromBlockIndex, range.toBlockIndex)),
      toBlockIndex: Math.max(0, Math.max(range.fromBlockIndex, range.toBlockIndex))
    }))
    .filter((range) => range.toBlockIndex >= range.fromBlockIndex)
    .sort((left, right) => left.fromBlockIndex - right.fromBlockIndex)

  const merged: Array<{ fromBlockIndex: number; toBlockIndex: number }> = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (!last || range.fromBlockIndex > last.toBlockIndex + 1) {
      merged.push(range)
      continue
    }
    last.toBlockIndex = Math.max(last.toBlockIndex, range.toBlockIndex)
  }
  return merged
}

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxOutlineTool = createDocxTool({
    runtime,
    name: DOCX_OUTLINE_TOOL_SPEC.name,
    description: DOCX_OUTLINE_TOOL_SPEC.description,
    schema: DOCX_OUTLINE_TOOL_SPEC.inputSchema,
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

      try {
        const ranges = args.ranges.map((range) =>
          toOutlineRange(range, sessionResult.stats.blockCount)
        )
        const mergedRanges = mergeOutlineRanges(ranges)
        const outlineBlocks = await runtime.callWorker({
          action: 'outline',
          payload: {
            docId: sessionResult.docId,
            ranges: mergedRanges,
            includeTables: true,
            includeCells: true
          }
        })
        if (!outlineBlocks.ok) {
          throw new Error(outlineBlocks.error)
        }
        if (outlineBlocks.payload.action !== 'outline') {
          throw new Error('worker protocol mismatch (outline)')
        }
        const resultBlocks = outlineBlocks.payload.blocks.map(buildOutlineBlock)
        const estimatedTokens = estimateDocxResultTokens(resultBlocks)
        if (estimatedTokens > getDocxAiResultTokenLimit(runtime)) {
          return finalizeDocxToolFailure({
            runtime,
            failure: buildResultTooLargeFailure({
              runtime,
              toolName,
              toolCallId,
              sourcePath: sessionResult.sourcePath,
              currentRevisionRef: sessionResult.currentRevisionRef,
              totalBlockCount: sessionResult.stats.blockCount,
              estimatedTokens,
              suggestedRanges: [
                {
                  type: 'percent',
                  fromPercent: 0,
                  toPercent: 20
                },
                {
                  type: 'block_index',
                  fromBlockIndex: 0,
                  toBlockIndex: Math.max(0, Math.min(20, sessionResult.stats.blockCount - 1))
                }
              ]
            }),
            activity: {
              actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!
            }
          })
        }
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `返回 ${String(resultBlocks.length)} 个结构块`,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          totalBlockCount: sessionResult.stats.blockCount,
          blocks: resultBlocks,
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
            blocks: result.blocks
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
            startedSummary: `提取结构: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `结构提取完成：${String(output.blocks.length)} 个块`
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
            actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!
          }
        })
      }
    }
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: DOCX_SEARCH_TOOL_SPEC.name,
    description: DOCX_SEARCH_TOOL_SPEC.description,
    schema: DOCX_SEARCH_TOOL_SPEC.inputSchema,
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
          outputPreview: buildSearchOutputPreview(result),
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
        outputPreview: buildSearchOutputPreview(result),
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
    schema: DOCX_READ_TOOL_SPEC.inputSchema,
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
        let blocks: DocxDetailedBlock[]
        let fromBlockIndex = 0
        let toBlockIndex = 0
        if (args.range.type === 'block_ids') {
          blocks = await fetchBlocksByBlockIds({
            runtime,
            session: sessionResult.readSession,
            docId: sessionResult.docId,
            blockIds: args.range.blockIds
          })
        } else {
          fromBlockIndex = args.range.fromBlockIndex
          toBlockIndex = args.range.toBlockIndex
          blocks = await fetchBlocksByBlockIndexRange({
            runtime,
            docId: sessionResult.docId,
            fromBlockIndex,
            toBlockIndex
          })
        }
        const result = {
          ok: true,
          code: 'ok' as const,
          summary: `返回 ${String(blocks.length)} 个连续块`,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          fromBlockIndex,
          toBlockIndex,
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
            fromBlockIndex: result.fromBlockIndex,
            toBlockIndex: result.toBlockIndex,
            blocks: result.blocks
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_TOOL_SPEC.activityActionType!,
            startedSummary: `精读文档区间: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `文档精读完成：${String(output.blocks.length)} 个块`
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
    schema: DOCX_HISTORY_TOOL_SPEC.inputSchema,
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

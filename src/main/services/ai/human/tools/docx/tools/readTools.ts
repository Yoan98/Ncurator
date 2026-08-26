import type { StructuredToolInterface } from '@langchain/core/tools'
import { buildSemanticMatches, splitEmbeddingRows } from '../semanticSearch'
import type { DocxToolRuntime } from '../runtime'
import type { DocxDetailedNode, DocxOutlineNode, DocxReadSession, DocxSearchMatch } from '../types'
import {
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_READ_NODES_TOOL_SPEC,
  DOCX_READ_VISUALS_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC
} from '../toolSpecs'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import { createVisualRecognitionService } from '../../../../../visualRecognition/service'
import { renderDocxVisualToPng } from '../utils/renderVisual'
import { projectDocxReadNodes } from '../publicReadTree'
import {
  DOCX_OUTLINE_ITEMS_PER_PAGE,
  DOCX_OUTLINE_TEXT_PREVIEW_CHARS,
  DOCX_OUTLINE_TEXT_PREVIEW_HEAD_CHARS
} from '../constants'

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

const normalizeOutlineText = (text: string): string => text.replace(/\s+/gu, ' ').trim()

const buildOutlineTextPreview = (text: string): string => {
  const characters = Array.from(normalizeOutlineText(text))
  if (characters.length <= DOCX_OUTLINE_TEXT_PREVIEW_CHARS) return characters.join('')
  const tailChars = DOCX_OUTLINE_TEXT_PREVIEW_CHARS - DOCX_OUTLINE_TEXT_PREVIEW_HEAD_CHARS - 1
  return `${characters.slice(0, DOCX_OUTLINE_TEXT_PREVIEW_HEAD_CHARS).join('')}…${characters
    .slice(-tailChars)
    .join('')}`
}

const buildOutlineNode = (node: Exclude<DocxOutlineNode, { type: 'table_cell' }>) => {
  const base = {
    nodeId: node.nodeId,
    nodeIndex: node.nodeIndex,
    story: node.story.type,
    textPreview: buildOutlineTextPreview(node.text)
  }
  if (node.type === 'paragraph') {
    return {
      ...base,
      type: node.type,
      styleId: node.style?.styleId,
      visuals: node.visuals
    }
  }
  if (node.type === 'table') {
    return {
      ...base,
      type: node.type,
      rows: node.rows,
      columns: node.cols,
      visuals: node.visuals
    }
  }
  return {
    ...base,
    type: node.type,
    ...(node.type === 'content_control' ? { tag: node.tag } : { revisionKind: node.revisionKind })
  }
}

const fetchNodesByNodeIds = async (input: {
  runtime: DocxToolRuntime
  session?: DocxReadSession
  docId: string
  nodeIds: string[]
}) => {
  const uniqueNodeIds = [...new Set(input.nodeIds)]
  if (uniqueNodeIds.length === 1) {
    const cached = input.session?.cache.detailByNodeId.get(uniqueNodeIds[0]!)
    if (cached) return [cached]
  }
  const nodeResponse = await input.runtime.callWorker({
    action: 'get_nodes_by_ids',
    payload: {
      docId: input.docId,
      nodeIds: uniqueNodeIds
    }
  })
  if (!nodeResponse.ok) {
    throw new Error(nodeResponse.error)
  }
  if (nodeResponse.payload.action !== 'get_nodes_by_ids') {
    throw new Error('worker protocol mismatch (get_nodes_by_ids)')
  }
  nodeResponse.payload.nodes.forEach((node) => {
    input.session?.cache.detailByNodeId.set(node.nodeId, node)
  })
  return nodeResponse.payload.nodes
}

const fetchNodesByNodeIndexRange = async (input: {
  runtime: DocxToolRuntime
  docId: string
  fromNodeIndex: number
  toNodeIndex: number
}) => {
  const nodeResponse = await input.runtime.callWorker({
    action: 'get_nodes_by_index_range',
    payload: {
      docId: input.docId,
      fromNodeIndex: input.fromNodeIndex,
      toNodeIndex: input.toNodeIndex
    }
  })
  if (!nodeResponse.ok) {
    throw new Error(nodeResponse.error)
  }
  if (nodeResponse.payload.action !== 'get_nodes_by_index_range') {
    throw new Error('worker protocol mismatch (get_nodes_by_index_range)')
  }
  return nodeResponse.payload.nodes
}

const executeWorkerSearch = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  docId: string
  query: string
  mode: 'literal' | 'regex'
  scopeNodeIds: string[]
  sourcePath: string
  currentRevisionRef: string
}): Promise<
  | {
      failure: ReturnType<DocxToolRuntime['emitFailure']>
    }
  | {
      matches: DocxSearchMatch[]
    }
> => {
  const workerResponse = await input.runtime.callWorker({
    action: 'search',
    payload: {
      docId: input.docId,
      query: input.query,
      mode: input.mode,
      scopeNodeIds: input.scopeNodeIds
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
        reason: 'failed',
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
    matches: workerResponse.payload.matches
  }
}

const buildLiteralSearchAttempts = (
  query: string
): Array<{ query: string; appliedAliases: AppliedAlias[] }> => {
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
  mode: 'literal' | 'regex' | 'semantic'
  effectiveQuery: string
  appliedAliases: AppliedAlias[]
  totalMatchCount: number
  matches: DocxSearchMatch[]
  runtime: DocxToolRuntime
}) => ({
  sourcePath: input.sourcePath,
  mode: input.mode,
  effectiveQuery: input.effectiveQuery,
  appliedAliases: input.appliedAliases,
  totalMatchCount: input.totalMatchCount,
  returnedMatchCount: input.matches.length,
  matches: input.matches.map((match) => ({
    nodeId: match.nodeId,
    nodeIndex: match.nodeIndex,
    type: match.type,
    matchedText: match.matchedText,
    previousNodeId: match.previousNodeId,
    nextNodeId: match.nextNodeId,
    tableNodeId: match.tableNodeId,
    text: match.text,
    offsets: match.offsets,
    score: match.score,
    story: match.story
  }))
})

const buildSearchOutputPreview = (result: ReturnType<typeof buildSearchResult>) => ({
  sourcePath: result.sourcePath,
  mode: result.mode,
  effectiveQuery: result.effectiveQuery,
  returnedMatchCount: result.returnedMatchCount,
  totalMatchCount: result.totalMatchCount
})

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const visualRecognitionService = createVisualRecognitionService(runtime.input.ctx)
  const docxOutlineTool = createDocxTool({
    runtime,
    name: DOCX_READ_OUTLINE_TOOL_SPEC.name,
    description: DOCX_READ_OUTLINE_TOOL_SPEC.promptSpec.description,
    schema: DOCX_READ_OUTLINE_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_READ_OUTLINE_TOOL_SPEC.activityActionType!,
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
        const totalPages = Math.max(
          1,
          Math.ceil(sessionResult.stats.rootNodeCount / DOCX_OUTLINE_ITEMS_PER_PAGE)
        )
        if (args.startPage > totalPages) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: `startPage 超出 outline 范围：startPage=${String(args.startPage)}，totalPages=${String(totalPages)}`,
              draftDocId: sessionResult.docId,
              resourceContext: runtime.buildResourceContext({
                sourcePath: sessionResult.sourcePath,
                effectKind: 'read',
                currentRevisionRef: sessionResult.currentRevisionRef
              })
            }),
            activity: { actionType: DOCX_READ_OUTLINE_TOOL_SPEC.activityActionType! }
          })
        }
        const endPage = Math.min(totalPages, args.startPage + args.pageCount - 1)
        const fromNodeIndex = (args.startPage - 1) * DOCX_OUTLINE_ITEMS_PER_PAGE
        const toNodeIndex = Math.min(
          sessionResult.stats.rootNodeCount - 1,
          endPage * DOCX_OUTLINE_ITEMS_PER_PAGE - 1
        )
        const outlineNodes = await runtime.callWorker({
          action: 'outline',
          payload: {
            docId: sessionResult.docId,
            fromNodeIndex,
            toNodeIndex,
            includeCells: false
          }
        })
        if (!outlineNodes.ok) {
          throw new Error(outlineNodes.error)
        }
        if (outlineNodes.payload.action !== 'outline') {
          throw new Error('worker protocol mismatch (outline)')
        }
        const resultNodes = outlineNodes.payload.nodes
          .filter(
            (node): node is Exclude<DocxOutlineNode, { type: 'table_cell' }> =>
              node.type !== 'table_cell'
          )
          .map(buildOutlineNode)
        const result = {
          startPage: args.startPage,
          endPage,
          totalPages,
          nodes: resultNodes
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            startPage: result.startPage,
            endPage: result.endPage,
            totalPages: result.totalPages,
            nodes: result.nodes
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_OUTLINE_TOOL_SPEC.activityActionType!,
            startedSummary: `提取结构: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `结构提取完成：${String(output.nodes.length)} 个节点`
          }
        })
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'failed',
            error: error instanceof Error ? error.message : String(error),
            draftDocId: sessionResult.docId,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'read',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_READ_OUTLINE_TOOL_SPEC.activityActionType!
          }
        })
      }
    }
  })

  const docxSearchTool = createDocxTool({
    runtime,
    name: DOCX_SEARCH_TOOL_SPEC.name,
    description: DOCX_SEARCH_TOOL_SPEC.promptSpec.description,
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
      const scopeNodeIds = args.nodeIds || []

      if (mode === 'semantic') {
        if (runtime.input.ctx.embeddingService.getStatus() !== 'ready') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'failed',
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
              reason: 'failed',
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
          scopeNodeIds,
          queryText: args.query,
          topK: SEMANTIC_TOP_K,
          minScore: SEMANTIC_MIN_SCORE
        })
        const matches = allMatches.slice(0, MAX_SEARCH_MATCHES)
        const result = buildSearchResult({
          sourcePath: sessionResult.sourcePath,
          mode,
          effectiveQuery: args.query,
          appliedAliases: [],
          totalMatchCount: allMatches.length,
          matches,
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
            buildCompletedSummary: (output) =>
              `文档搜索完成：${String(output.returnedMatchCount)} 个命中`
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

      for (const attempt of attempts) {
        const searchResult = await executeWorkerSearch({
          runtime,
          toolName,
          toolCallId,
          docId: sessionResult.docId,
          query: attempt.query,
          mode,
          scopeNodeIds,
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
        effectiveQuery = attempt.query
        appliedAliases = attempt.appliedAliases
        if (allMatches.length > 0 || mode !== 'literal') {
          break
        }
      }

      const matches = allMatches.slice(0, MAX_SEARCH_MATCHES)
      const result = buildSearchResult({
        sourcePath: sessionResult.sourcePath,
        mode,
        effectiveQuery,
        appliedAliases,
        totalMatchCount: allMatches.length,
        matches,
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
          buildCompletedSummary: (output) =>
            `文档搜索完成：${String(output.returnedMatchCount)} 个命中`
        }
      })
    }
  })

  const docxReadNodesTool = createDocxTool({
    runtime,
    name: DOCX_READ_NODES_TOOL_SPEC.name,
    description: DOCX_READ_NODES_TOOL_SPEC.promptSpec.description,
    schema: DOCX_READ_NODES_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_READ_NODES_TOOL_SPEC.activityActionType!,
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
        let nodes: DocxDetailedNode[]
        if (args.range.type === 'node_ids') {
          nodes = await fetchNodesByNodeIds({
            runtime,
            session: sessionResult.readSession,
            docId: sessionResult.docId,
            nodeIds: args.range.nodeIds
          })
        } else {
          nodes = await fetchNodesByNodeIndexRange({
            runtime,
            docId: sessionResult.docId,
            fromNodeIndex: args.range.fromNodeIndex,
            toNodeIndex: args.range.toNodeIndex
          })
        }
        const result = {
          sourcePath: sessionResult.sourcePath,
          nodes: projectDocxReadNodes(nodes)
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            sourcePath: result.sourcePath,
            nodes: result.nodes
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_NODES_TOOL_SPEC.activityActionType!,
            startedSummary: `精读文档区间: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) => `文档精读完成：${String(output.nodes.length)} 个节点`
          }
        })
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'failed',
            error: error instanceof Error ? error.message : String(error),
            draftDocId: sessionResult.docId,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'read',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_READ_NODES_TOOL_SPEC.activityActionType!
          }
        })
      }
    }
  })

  const docxReadVisualsTool = createDocxTool({
    runtime,
    name: DOCX_READ_VISUALS_TOOL_SPEC.name,
    description: DOCX_READ_VISUALS_TOOL_SPEC.promptSpec.description,
    schema: DOCX_READ_VISUALS_TOOL_SPEC.inputSchema,
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureReadSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-visual-'))
      try {
        let renderSourcePath: string | undefined
        const results = new Array<
          { visualId: string; text: string } | { visualId: string; error: string } | undefined
        >(args.requests.length)
        const stagedImages: Array<{ index: number; path: string; mimeType: string }> = []
        const stagedRequests: Array<{ index: number; instruction: string }> = []

        for (const [index, request] of args.requests.entries()) {
          const tempPath = path.join(tempDir, `${String(index)}.visual`)
          try {
            const response = await runtime.callWorker({
              action: 'get_visual',
              payload: { docId: sessionResult.docId, visualId: request.visualId }
            })
            if (!response.ok) {
              results[index] = { visualId: request.visualId, error: response.error }
              continue
            }
            if (response.payload.action !== 'get_visual') {
              results[index] = {
                visualId: request.visualId,
                error: 'worker protocol mismatch (get_visual)'
              }
              continue
            }
            if (response.payload.error) {
              results[index] = {
                visualId: request.visualId,
                error: response.payload.error || 'visual media is missing'
              }
              continue
            }
            let visualData = response.payload.data
            let mimeType = response.payload.mimeType
            if ((!visualData || !mimeType) && response.payload.render) {
              if (!renderSourcePath) {
                const draftPath = path.join(tempDir, 'active-revision.docx')
                const materialized = await runtime.callWorker({
                  action: 'materialize_draft',
                  payload: { docId: sessionResult.docId, outPath: draftPath }
                })
                if (!materialized.ok) {
                  results[index] = { visualId: request.visualId, error: materialized.error }
                  continue
                }
                if (materialized.payload.action !== 'materialize_draft') {
                  results[index] = {
                    visualId: request.visualId,
                    error: 'worker protocol mismatch (materialize_draft)'
                  }
                  continue
                }
                renderSourcePath = materialized.payload.outPath
              }
              const rendered = await renderDocxVisualToPng({
                sourcePath: renderSourcePath,
                kind: response.payload.kind,
                nodeIndex: response.payload.render.nodeIndex,
                visualIndexInNode: response.payload.render.visualIndexInNode,
                visualCountInNode: response.payload.render.visualCountInNode
              })
              if (!rendered.data) {
                results[index] = {
                  visualId: request.visualId,
                  error: rendered.error || 'visual rendering failed'
                }
                continue
              }
              visualData = rendered.data
              mimeType = 'image/png'
            }
            if (!visualData || !mimeType) {
              results[index] = { visualId: request.visualId, error: 'visual media is missing' }
              continue
            }
            await fs.writeFile(tempPath, visualData)
            stagedImages.push({ index, path: tempPath, mimeType })
            stagedRequests.push({ index, instruction: request.instruction })
          } catch (error) {
            results[index] = {
              visualId: request.visualId,
              error: error instanceof Error ? error.message : String(error)
            }
          }
        }

        if (stagedImages.length > 0) {
          const recognition = await visualRecognitionService.recognizeImages({
            images: stagedImages,
            requests: stagedRequests
          })
          for (const item of recognition) {
            const request = args.requests[item.index]
            if (!request) continue
            results[item.index] =
              'text' in item
                ? { visualId: request.visualId, text: item.text }
                : { visualId: request.visualId, error: item.error }
          }
        }

        const result = {
          sourcePath: sessionResult.sourcePath,
          results: results.filter(
            (
              item
            ): item is { visualId: string; text: string } | { visualId: string; error: string } =>
              item !== undefined
          )
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_VISUALS_TOOL_SPEC.activityActionType!,
            startedSummary: `读取文档视觉内容: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) =>
              `文档视觉读取完成：${String(output.results.length)} 项`
          }
        })
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'failed',
            error: error instanceof Error ? error.message : String(error),
            draftDocId: sessionResult.docId
          }),
          activity: { actionType: DOCX_READ_VISUALS_TOOL_SPEC.activityActionType! }
        })
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    }
  })

  return [docxOutlineTool, docxSearchTool, docxReadNodesTool, docxReadVisualsTool]
}
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

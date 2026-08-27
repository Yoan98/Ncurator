import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type { DocxDetailedNode, DocxReadSession, DocxSearchMatch } from '../types'
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
import { DOCX_OUTLINE_MAX_SEGMENTS } from '../constants'
import {
  countOutlineRootNodes,
  resolveOutlinePercentNodeRange,
  selectOutlineSegmentsForNodeRange
} from '../outlineRange'

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
  includeContext: boolean
}): Promise<
  | {
      failure: ReturnType<DocxToolRuntime['emitFailure']>
    }
  | {
      totalMatchCount: number
      matches: DocxSearchMatch[]
    }
> => {
  const workerResponse = await input.runtime.callWorker({
    action: 'search',
    payload: {
      docId: input.docId,
      query: input.query,
      mode: input.mode,
      scopeNodeIds: input.scopeNodeIds,
      includeContext: input.includeContext
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
    totalMatchCount: workerResponse.payload.totalMatchCount,
    matches: workerResponse.payload.matches
  }
}

const buildSearchResult = (input: { totalMatchCount: number; matches: DocxSearchMatch[] }) => ({
  totalMatchCount: input.totalMatchCount,
  matches: input.matches.map((match) => ({
    nodeId: match.nodeId,
    nodeIndex: match.nodeIndex,
    type: match.type,
    story: match.story.type,
    matchText: match.matchText,
    textContext: match.textContext,
    tableNodeId: match.tableNodeId,
    before: match.before,
    after: match.after
  }))
})

const buildSearchOutputPreview = (result: ReturnType<typeof buildSearchResult>) => ({
  totalMatchCount: result.totalMatchCount,
  matches: result.matches
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
        const segmentResponse = await runtime.callWorker({
          action: 'segment_map',
          payload: { docId: sessionResult.docId }
        })
        if (!segmentResponse.ok) throw new Error(segmentResponse.error)
        if (segmentResponse.payload.action !== 'segment_map') {
          throw new Error('worker protocol mismatch (segment_map)')
        }
        const allSegments = segmentResponse.payload.segments
        const totalRootCount = countOutlineRootNodes(allSegments)
        const nodeRange = resolveOutlinePercentNodeRange({
          fromPercent: args.fromPercent,
          toPercent: args.toPercent,
          totalRootCount
        })
        const selectedSegments = nodeRange
          ? selectOutlineSegmentsForNodeRange(allSegments, nodeRange)
          : []
        if (selectedSegments.length > DOCX_OUTLINE_MAX_SEGMENTS) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: `一次最多返回 ${String(DOCX_OUTLINE_MAX_SEGMENTS)} 个分段，当前区间覆盖 ${String(selectedSegments.length)} 个`,
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
        const coveredFromNodeIndex =
          selectedSegments.length > 0
            ? Math.min(...selectedSegments.map((segment) => segment.fromNodeIndex))
            : 0
        const coveredToNodeIndex =
          selectedSegments.length > 0
            ? Math.max(...selectedSegments.map((segment) => segment.toNodeIndex))
            : 0
        const result = {
          fromPercent: args.fromPercent,
          toPercent: args.toPercent,
          fromNodeIndex: coveredFromNodeIndex,
          toNodeIndex: coveredToNodeIndex,
          totalRootCount,
          segments: selectedSegments
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            fromPercent: result.fromPercent,
            toPercent: result.toPercent,
            fromNodeIndex: result.fromNodeIndex,
            toNodeIndex: result.toNodeIndex,
            totalRootCount: result.totalRootCount,
            segments: result.segments
          },
          draftDocId: sessionResult.docId,
          activity: {
            actionType: DOCX_READ_OUTLINE_TOOL_SPEC.activityActionType!,
            startedSummary: `提取结构: ${sessionResult.sourcePath}`,
            buildCompletedSummary: (output) =>
              `结构提取完成：${String(output.segments.length)} 个分段`
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
      const searchResult = await executeWorkerSearch({
        runtime,
        toolName,
        toolCallId,
        docId: sessionResult.docId,
        query: args.query,
        mode,
        scopeNodeIds,
        includeContext: args.includeContext || false,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef
      })
      if ('failure' in searchResult) {
        return finalizeDocxToolFailure({
          runtime,
          failure: searchResult.failure,
          activity: { actionType: DOCX_SEARCH_TOOL_SPEC.activityActionType! }
        })
      }
      const result = buildSearchResult({
        totalMatchCount: searchResult.totalMatchCount,
        matches: searchResult.matches
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
          buildCompletedSummary: (output) => `文档搜索完成：${String(output.matches.length)} 个命中`
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

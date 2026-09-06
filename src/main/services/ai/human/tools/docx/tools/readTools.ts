import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type { DocxDetailedNode, DocxReadNode, DocxReadSession, DocxSearchMatch } from '../types'
import {
  DOCX_READ_OUTLINE_TOOL_SPEC,
  DOCX_READ_NODES_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC
} from '../toolSpecs'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import { projectDocxReadNodes } from '../publicReadTree'
import { renderDocxVisualToPng } from '../utils/renderVisual'
import { ensurePartnerAssetBucket } from '../../../../../assets/WorkspaceAssetService'
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

const extensionForMime = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  return 'jpg'
}

const collectVisualNodes = (
  nodes: DocxReadNode[]
): Array<Extract<DocxReadNode, { type: 'visual' }>> => {
  const visuals: Array<Extract<DocxReadNode, { type: 'visual' }>> = []
  const visit = (node: DocxReadNode): void => {
    if (node.type === 'visual') visuals.push(node)
    if ('children' in node && Array.isArray(node.children)) {
      ;(node.children as DocxReadNode[]).forEach(visit)
    }
  }
  nodes.forEach(visit)
  return visuals
}

const materializeDocxVisuals = async (input: {
  runtime: DocxToolRuntime
  docId: string
  nodes: DocxDetailedNode[]
  sourcePrefix: 'docx_read_nodes' | 'docx_search'
}): Promise<void> => {
  const readNodes: DocxReadNode[] = []
  input.nodes.forEach((node) => readNodes.push(...(node.children as DocxReadNode[])))
  const visuals = collectVisualNodes(readNodes)
  if (visuals.length === 0) return
  const bucket = await ensurePartnerAssetBucket(
    input.runtime.input.partnerId,
    `${input.sourcePrefix}-${randomUUID()}`
  )
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-materialize-'))
  let renderSourcePath: string | undefined
  try {
    for (const visual of visuals) {
      const response = await input.runtime.callWorker({
        action: 'get_visual',
        payload: { docId: input.docId, nodeId: visual.nodeId }
      })
      if (!response.ok) throw new Error(response.error)
      if (response.payload.action !== 'get_visual') {
        throw new Error('worker protocol mismatch (get_visual)')
      }
      if (response.payload.error) throw new Error(response.payload.error)
      let bytes = response.payload.data ? Buffer.from(response.payload.data) : undefined
      let mimeType = response.payload.mimeType
      if ((!bytes || !mimeType) && response.payload.render) {
        if (!renderSourcePath) {
          renderSourcePath = path.join(tempDir, 'active-revision.docx')
          const materialized = await input.runtime.callWorker({
            action: 'materialize_draft',
            payload: { docId: input.docId, outPath: renderSourcePath }
          })
          if (!materialized.ok) throw new Error(materialized.error)
          if (materialized.payload.action !== 'materialize_draft') {
            throw new Error('worker protocol mismatch (materialize_draft)')
          }
        }
        const rendered = await renderDocxVisualToPng({
          sourcePath: renderSourcePath,
          kind: response.payload.kind,
          nodeIndex: response.payload.render.nodeIndex,
          visualIndexInNode: response.payload.render.visualIndexInNode,
          visualCountInNode: response.payload.render.visualCountInNode
        })
        if (rendered.data) {
          bytes = Buffer.from(rendered.data)
          mimeType = 'image/png'
        }
      }
      if (!bytes || !mimeType) throw new Error(`visual node ${visual.nodeId} 无法生成图片`)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const imagePath = path.join(bucket, `${hash}.${extensionForMime(mimeType)}`)
      try {
        await fs.writeFile(imagePath, bytes, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      visual.imagePath = imagePath
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
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

const buildSearchResult = (input: {
  totalMatchCount: number
  matches: DocxSearchMatch[]
  nodesById: Map<string, ReturnType<typeof projectDocxReadNodes>[number]>
}) => ({
  totalMatchCount: input.totalMatchCount,
  returnedMatchCount: input.matches.length,
  matches: input.matches.map((match) => ({
    nodeId: match.nodeId,
    nodeIndex: match.nodeIndex,
    type: match.type,
    story: match.story.type,
    matchText: match.matchText,
    textContext: match.textContext,
    tableNodeId: match.tableNodeId,
    node: input.nodesById.get(match.nodeId),
    beforeNodes: match.before?.flatMap((neighbor) => {
      const node = input.nodesById.get(neighbor.nodeId)
      return node ? [node] : []
    }),
    afterNodes: match.after?.flatMap((neighbor) => {
      const node = input.nodesById.get(neighbor.nodeId)
      return node ? [node] : []
    })
  }))
})

const buildSearchOutputPreview = (result: ReturnType<typeof buildSearchResult>) => ({
  totalMatchCount: result.totalMatchCount,
  returnedMatchCount: result.returnedMatchCount,
  matches: result.matches
})

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
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
      const relatedNodeIds = [
        ...new Set(
          searchResult.matches.flatMap((match) => [
            match.nodeId,
            ...(match.before || []).map((neighbor) => neighbor.nodeId),
            ...(match.after || []).map((neighbor) => neighbor.nodeId)
          ])
        )
      ]
      const relatedNodes = relatedNodeIds.length
        ? await fetchNodesByNodeIds({
            runtime,
            session: sessionResult.readSession,
            docId: sessionResult.docId,
            nodeIds: relatedNodeIds
          })
        : []
      await materializeDocxVisuals({
        runtime,
        docId: sessionResult.docId,
        nodes: relatedNodes,
        sourcePrefix: 'docx_search'
      })
      const publicNodes = projectDocxReadNodes(relatedNodes)
      const nodesById = new Map(publicNodes.map((node) => [node.nodeId, node]))
      const result = buildSearchResult({
        totalMatchCount: searchResult.totalMatchCount,
        matches: searchResult.matches,
        nodesById
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
        await materializeDocxVisuals({
          runtime,
          docId: sessionResult.docId,
          nodes,
          sourcePrefix: 'docx_read_nodes'
        })
        const result = {
          nodes: projectDocxReadNodes(nodes)
        }
        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
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

  return [docxOutlineTool, docxSearchTool, docxReadNodesTool]
}

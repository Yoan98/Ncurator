import type {
  DocxChangedNode,
  DocxDetailedNode,
  DocxOpenStats,
  DocxOperation,
  DocxOutlineNode,
  DocxOutlineSegment,
  DocxSearchMatch,
  DocxSearchMode,
  DocxValidationProblem
} from '../types'
import type { NodeIndex, ParsedDocxBundle } from '../adapters/ooxml/types'
import type { DocxIdentityIndex } from './identity'

export type DocxWorkerAction =
  | 'open'
  | 'outline'
  | 'segment_map'
  | 'get_node'
  | 'get_node_layout'
  | 'get_nodes_by_ids'
  | 'get_nodes_by_range'
  | 'get_nodes_by_index_range'
  | 'get_replay_snapshot_xml'
  | 'get_annotations'
  | 'search'
  | 'get_visual'
  | 'apply_operations'
  | 'materialize_draft'
  | 'release_run'

export type DocxWorkerRequest =
  | {
      requestId: string
      runId: string
      action: 'get_annotations'
      payload: { docId: string }
    }
  | {
      requestId: string
      runId: string
      action: 'get_replay_snapshot_xml'
      payload: { docId: string }
    }
  | {
      requestId: string
      runId: string
      action: 'get_visual'
      payload: { docId: string; visualId: string }
    }
  | {
      requestId: string
      runId: string
      action: 'open'
      payload: {
        sourcePath: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'segment_map'
      payload: { docId: string }
    }
  | {
      requestId: string
      runId: string
      action: 'outline'
      payload: {
        docId: string
        fromNodeIndex: number
        toNodeIndex: number
        includeCells: boolean
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_node'
      payload: {
        docId: string
        nodeId: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_node_layout'
      payload: {
        docId: string
        nodeId: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_nodes_by_ids'
      payload: {
        docId: string
        nodeIds: string[]
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_nodes_by_index_range'
      payload: {
        docId: string
        fromNodeIndex: number
        toNodeIndex: number
      }
    }
  | {
      requestId: string
      runId: string
      action: 'search'
      payload: {
        docId: string
        query: string
        mode: DocxSearchMode
        scopeNodeIds: string[]
        includeContext: boolean
      }
    }
  | {
      requestId: string
      runId: string
      action: 'apply_operations'
      payload: {
        docId: string
        operations: DocxOperation[]
      }
    }
  | {
      requestId: string
      runId: string
      action: 'materialize_draft'
      payload: {
        docId: string
        outPath: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'release_run'
      payload: Record<string, never>
    }

export type DocxWorkerSuccessPayload =
  | {
      action: 'get_annotations'
      trackChanges: boolean
      comments: Array<{
        commentId: string
        text: string
        author: string
        parentCommentId?: string
      }>
      revisions: Array<{
        revisionId: string
        kind: 'insert' | 'delete' | 'move_from' | 'move_to'
      }>
    }
  | {
      action: 'get_replay_snapshot_xml'
      packageFingerprint: string
      nodes: Array<{ nodeId: string; rawXml: string }>
    }
  | {
      action: 'get_visual'
      visualId: string
      kind: 'image' | 'chart' | 'diagram' | 'shape' | 'embedded_object'
      data?: Buffer
      mimeType?: string
      error?: string
      render?: {
        nodeIndex: number
        visualIndexInNode: number
        visualCountInNode: number
      }
    }
  | {
      action: 'open'
      docId: string
      stats: DocxOpenStats
      checksum: string
      byteSize: number
    }
  | {
      action: 'outline'
      nodes: DocxOutlineNode[]
    }
  | {
      action: 'segment_map'
      segments: DocxOutlineSegment[]
    }
  | {
      action: 'get_node'
      node: DocxDetailedNode
    }
  | {
      action: 'get_node_layout'
      ownerNodeId: string
      layoutMode: 'normal' | 'positioned'
      text: string
    }
  | {
      action: 'get_nodes_by_ids'
      nodes: DocxDetailedNode[]
    }
  | {
      action: 'get_nodes_by_index_range'
      nodes: DocxDetailedNode[]
    }
  | {
      action: 'search'
      totalMatchCount: number
      matches: DocxSearchMatch[]
    }
  | {
      action: 'apply_operations'
      newDocId: string
      stats: DocxOpenStats
      changedNodes: DocxChangedNode[]
    }
  | {
      action: 'materialize_draft'
      outPath: string
      checksum: string
      byteSize: number
    }
  | {
      action: 'release_run'
      releasedDocCount: number
    }

export type DocxWorkerResponse =
  | {
      requestId: string
      ok: true
      payload: DocxWorkerSuccessPayload
    }
  | {
      requestId: string
      ok: false
      code: 'failed' | 'invalid_input'
      error: string
    }

type DocSnapshotBase = {
  docId: string
  sourcePath: string
  createdAt: number
  parentDocId?: string
  buffer: Buffer
  checksum: string
  index: NodeIndex
  identity: DocxIdentityIndex
  detailByNodeId: Map<string, DocxDetailedNode>
}

export type DocSnapshot = DocSnapshotBase &
  (
    | {
        format: 'docx'
        bundle: ParsedDocxBundle
        baselineValidationProblems: DocxValidationProblem[]
      }
    | {
        format: 'doc'
      }
  )

export type RunSessions = Map<string, Map<string, DocSnapshot>>

export type PendingRequest = {
  resolve: (response: DocxWorkerResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

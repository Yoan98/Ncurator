import type {
  DocxChangedBlock,
  DocxDetailedBlock,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOp,
  DocxOutlineBlock,
  DocxSearchMatch,
  DocxSearchMode
} from '../types'
import type { BlockIndex, ParsedDocxBundle } from '../adapters/ooxml/types'

export type DocxWorkerAction =
  | 'open'
  | 'outline'
  | 'get_block'
  | 'get_blocks_by_ids'
  | 'get_blocks_by_range'
  | 'search'
  | 'apply_ops'
  | 'materialize_draft'
  | 'release_run'

export type DocxWorkerRequest =
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
      action: 'outline'
      payload: {
        docId: string
        fromBodyIndex?: number
        maxBlocks: number
        includeTables: boolean
        includeCells: boolean
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_block'
      payload: {
        docId: string
        blockId: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_blocks_by_ids'
      payload: {
        docId: string
        blockIds: string[]
      }
    }
  | {
      requestId: string
      runId: string
      action: 'get_blocks_by_range'
      payload: {
        docId: string
        fromBlockId: string
        toBlockId: string
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
        scopeBlockIds: string[]
      }
    }
  | {
      requestId: string
      runId: string
      action: 'apply_ops'
      payload: {
        docId: string
        ops: DocxOp[]
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
      action: 'open'
      docId: string
      meta: DocxOpenMeta
      stats: DocxOpenStats
    }
  | {
      action: 'outline'
      blocks: DocxOutlineBlock[]
      truncated: boolean
    }
  | {
      action: 'get_block'
      block: DocxDetailedBlock
    }
  | {
      action: 'get_blocks_by_ids'
      blocks: DocxDetailedBlock[]
    }
  | {
      action: 'get_blocks_by_range'
      blocks: DocxDetailedBlock[]
    }
  | {
      action: 'search'
      matches: DocxSearchMatch[]
      warnings: string[]
    }
  | {
      action: 'apply_ops'
      newDocId: string
      changedBlocks: DocxChangedBlock[]
      warnings: string[]
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
      warnings?: string[]
    }

export type DocSnapshot = {
  docId: string
  sourcePath: string
  createdAt: number
  parentDocId?: string
  buffer: Buffer
  bundle: ParsedDocxBundle
  index: BlockIndex
  detailByBlockId: Map<string, DocxDetailedBlock>
}

export type RunSessions = Map<string, Map<string, DocSnapshot>>

export type PendingRequest = {
  resolve: (response: DocxWorkerResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

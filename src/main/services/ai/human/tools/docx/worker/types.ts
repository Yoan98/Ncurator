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
import type { DocxIdentityIndex } from './identity'

export type DocxWorkerAction =
  | 'open'
  | 'outline'
  | 'get_block'
  | 'get_blocks_by_ids'
  | 'get_blocks_by_range'
  | 'get_blocks_by_block_index_range'
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
        ranges: Array<{
          fromBlockIndex: number
          toBlockIndex: number
        }>
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
      action: 'get_blocks_by_block_index_range'
      payload: {
        docId: string
        fromBlockIndex: number
        toBlockIndex: number
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
      checksum: string
      byteSize: number
    }
  | {
      action: 'outline'
      blocks: DocxOutlineBlock[]
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
      action: 'get_blocks_by_block_index_range'
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
  checksum: string
  bundle: ParsedDocxBundle
  index: BlockIndex
  identity: DocxIdentityIndex
  detailByBlockId: Map<string, DocxDetailedBlock>
}

export type RunSessions = Map<string, Map<string, DocSnapshot>>

export type PendingRequest = {
  resolve: (response: DocxWorkerResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

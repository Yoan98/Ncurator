import type {
  DocxChangedBlock,
  DocxDetailedBlock,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOp,
  DocxOutlineBlock,
  DocxSearchMatch,
  DocxSearchMode,
  DocxValidationProblem
} from '../types'

export type DocxWorkerAction =
  | 'open'
  | 'outline'
  | 'get_block'
  | 'search'
  | 'apply_ops'
  | 'render_preview'
  | 'save'
  | 'validate'
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
      action: 'render_preview'
      payload: {
        docId: string
        format: 'html' | 'png' | 'pdf'
        previewPath: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'save'
      payload: {
        docId: string
        outPath: string
      }
    }
  | {
      requestId: string
      runId: string
      action: 'validate'
      payload: {
        docId: string
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
      action: 'render_preview'
      format: 'html' | 'png' | 'pdf'
      previewPath: string
      renderer: 'docx_file_artifact'
    }
  | {
      action: 'save'
      outPath: string
      checksum: string
      byteSize: number
    }
  | {
      action: 'validate'
      problems: DocxValidationProblem[]
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

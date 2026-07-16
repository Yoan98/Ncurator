import type {
  PdfOpenResult,
  PdfPageReadResult,
  PdfRenderedImage,
  PdfSearchMatch,
  PdfSearchMode
} from '../types'

export type PdfWorkerAction = 'open' | 'read_pages' | 'search' | 'render_pages' | 'release_run'

export type PdfWorkerRequest =
  | {
      requestId: string
      runId: string
      action: 'open'
      payload: { sourcePath: string }
    }
  | {
      requestId: string
      runId: string
      action: 'read_pages'
      payload: { docId: string; pageNumbers: number[] }
    }
  | {
      requestId: string
      runId: string
      action: 'search'
      payload: {
        docId: string
        query: string
        mode: PdfSearchMode
        fromPage: number
        toPage: number
        maxMatches: number
      }
    }
  | {
      requestId: string
      runId: string
      action: 'render_pages'
      payload: {
        docId: string
        workspaceRootPath: string
        pageNumbers: number[]
      }
    }
  | {
      requestId: string
      runId: string
      action: 'release_run'
      payload: Record<string, never>
    }

export type PdfWorkerSuccessPayload =
  | ({ action: 'open' } & PdfOpenResult)
  | { action: 'read_pages'; pages: PdfPageReadResult[] }
  | {
      action: 'search'
      totalMatchCount: number
      matches: PdfSearchMatch[]
      pagesWithNoTextCount: number
      pagesWithSuspiciousTextCount: number
      warnings: string[]
    }
  | {
      action: 'render_pages'
      assetBucketId: string
      images: PdfRenderedImage[]
      warnings: string[]
    }
  | { action: 'release_run'; releasedDocCount: number }

export type PdfWorkerResponse =
  | { requestId: string; ok: true; payload: PdfWorkerSuccessPayload }
  | {
      requestId: string
      ok: false
      code:
        | 'invalid_input'
        | 'invalid_pdf'
        | 'password_required'
        | 'encrypted_pdf_unsupported'
        | 'failed'
      error: string
      warnings?: string[]
    }

export type PendingPdfWorkerRequest = {
  resolve: (response: PdfWorkerResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

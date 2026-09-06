import type {
  PdfOpenResult,
  PdfPageReadResult,
  PdfRenderedImage,
  PdfSearchMatch,
  PdfSearchMode
} from '../types'

export type PdfWorkerAction = 'open' | 'read_pages' | 'search' | 'materialize_pages' | 'release_run'

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
      action: 'materialize_pages'
      payload: {
        docId: string
        partnerId: string
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
    }
  | {
      action: 'materialize_pages'
      assetBucketId: string
      images: PdfRenderedImage[]
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
    }

export type PendingPdfWorkerRequest = {
  resolve: (response: PdfWorkerResponse) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

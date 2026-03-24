import type {
  DraftDocumentFormat,
  DraftReviewDetail,
  DraftReviewStatus,
  SearchResult
} from '../../../../shared/types'

export type WorkbenchMode = 'ai' | 'search'

export type SearchWorkbenchTurn = {
  query: string
  results: SearchResult[]
  tokens: string[]
  createdAt: number
}

export type WorkbenchFileOrigin = 'search_hit' | 'read' | 'edited_draft' | 'artifact' | 'preview'

export type WorkbenchFileRef = {
  path: string
  fileName: string
  origin: WorkbenchFileOrigin
  summary?: string
  reviewId?: string
  draftDocumentId?: string
  format?: DraftDocumentFormat
  pageNumber?: number
}

export type AssistantStepStatus = 'running' | 'completed' | 'review_needed' | 'failed'

export type AssistantTurnStep = {
  id: string
  summary: string
  tool: string
  status: AssistantStepStatus
  files: WorkbenchFileRef[]
}

export type AssistantTurnReviewTarget = {
  reviewId: string
  title: string
  changeCount: number
  documentCount: number
  status?: DraftReviewStatus
}

export type AssistantTurnBlocker = {
  kind: 'approval' | 'workspace'
  title: string
  description: string
}

export type AssistantTurnViewModel = {
  messageId: string
  runId?: string
  finalAnswer: string
  status: 'running' | 'completed' | 'failed'
  steps: AssistantTurnStep[]
  readFiles: WorkbenchFileRef[]
  editedFiles: WorkbenchFileRef[]
  reviewTargets: AssistantTurnReviewTarget[]
  blockers: AssistantTurnBlocker[]
  error?: string
}

export type WorkbenchContentPanelState =
  | {
      kind: 'empty'
      title: string
      description: string
    }
  | {
      kind: 'search_results'
      title: string
      query: string
      results: SearchResult[]
      tokens: string[]
    }
  | {
      kind: 'document_view'
      title: string
      file: WorkbenchFileRef
      searchResult?: SearchResult
    }
  | {
      kind: 'review_session'
      title: string
      reviewId: string
      review?: DraftReviewDetail | null
    }

import type { DocxApplyStatus, SearchResult } from '../../../../shared/types'

export type WorkbenchMode = 'ai' | 'search'

export type WorkbenchContextUsage = {
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}

export type SearchWorkbenchTurn = {
  query: string
  results: SearchResult[]
  tokens: string[]
  createdAt: number
}

export type WorkbenchFileOrigin =
  | 'search_hit'
  | 'read'
  | 'artifact'
  | 'preview'
  | 'source'

export type WorkbenchFileRef = {
  path: string
  fileName: string
  origin: WorkbenchFileOrigin
  summary?: string
  applyId?: string
  format?: 'docx'
  pageNumber?: number
}

export type DocxApplyWorkspaceTab = {
  fileKey: string
  applyId: string
  fileName: string
  sourcePath: string
  changeCount: number
  status: DocxApplyStatus
  unseen: boolean
}

export type AssistantStepStatus = 'running' | 'completed' | 'review_needed' | 'failed'

export type AssistantTurnStep = {
  id: string
  summary: string
  tool: string
  status: AssistantStepStatus
  files: WorkbenchFileRef[]
}

export type AssistantTurnApplyTarget = {
  applyId: string
  title: string
  changeCount: number
  status?: DocxApplyStatus
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
  applyTargets: AssistantTurnApplyTarget[]
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
      kind: 'search_list'
      title: string
      query: string
      results: SearchResult[]
      tokens: string[]
    }
  | {
      kind: 'file_preview'
      title: string
      file: WorkbenchFileRef
    }
  | {
      kind: 'apply_workspace'
      title: string
      tabs: DocxApplyWorkspaceTab[]
      activeFileKey: string | null
    }

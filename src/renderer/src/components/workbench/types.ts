import type { AiRunEvent, DocxApplyStatus, SearchResult } from '../../../../shared/types'

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

export type WorkbenchFileOrigin = 'search_hit' | 'read' | 'artifact' | 'preview' | 'source'

export type WorkbenchFileRef = {
  path: string
  fileName: string
  origin: WorkbenchFileOrigin
  summary?: string
  applyId?: string
  format?: 'docx'
  pageNumber?: number
}

export type AssistantProcessStatus = 'running' | 'completed' | 'failed' | 'waiting'

export type AssistantProcessSourceEventType = 'thinking' | AiRunEvent['type']

export type AssistantProcessItem = {
  id: string
  text: string
  status: AssistantProcessStatus
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
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

export type AssistantArtifactItem = WorkbenchFileRef & {
  operation?: 'created' | 'updated'
}

export type AssistantTurnViewModel = {
  messageId: string
  runId?: string
  status: 'running' | 'completed' | 'failed'
  processItems: AssistantProcessItem[]
  finalAnswerMarkdown: string
  artifacts: AssistantArtifactItem[]
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

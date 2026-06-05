import type {
  AiRunEvent,
  DocxApplyStatus,
  RuntimeSkillId,
  SearchResult
} from '../../../../shared/types'

export type WorkbenchMode = 'ai' | 'search'

export type WorkbenchPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type WorkbenchModelPreference = {
  configId: string
  modelName: string
}

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

export type AssistantProcessStatus = 'running' | 'completed' | 'failed'

export type AssistantProcessSourceEventType = 'thinking' | AiRunEvent['type']

export type AssistantRichTextSegment = {
  text: string
  emphasis?: boolean
}

export type AssistantToolName =
  | 'terminal_run'
  | 'kb_search'
  | 'kb_list_documents'
  | 'docx_outline'
  | 'docx_search'
  | 'docx_read_blocks'
  | 'docx_history'
  | 'docx_edit'
  | 'docx_rollback'
  | 'unnamed'

export type AssistantProcessIconKind =
  | 'search'
  | 'terminal'
  | 'document'
  | 'edit'
  | 'learning'
  | 'compaction'
  | 'default'

export type AssistantProcessGroupKind = 'thinking' | 'skill' | 'learning' | 'compaction'

export type AssistantProcessSkillKey =
  | 'docx-reader'
  | 'docx-writer'
  | 'reference-reader'
  | 'terminal-runner'
  | 'generic-task'

export type AssistantProcessGroupItem = {
  id: string
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
  toolName?: AssistantToolName
}

export type AssistantProcessGroup = {
  id: string
  kind: AssistantProcessGroupKind
  skillKey: AssistantProcessSkillKey
  iconKind: AssistantProcessIconKind
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  items: AssistantProcessGroupItem[]
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
  skillId?: RuntimeSkillId
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
  processGroups: AssistantProcessGroup[]
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

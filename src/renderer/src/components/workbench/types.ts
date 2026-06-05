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

export type AssistantProcessStatus = 'active' | 'completed' | 'failed'

export type AssistantProcessSourceEventType = 'thinking' | AiRunEvent['type']

export type AssistantProcessNodeKind =
  | 'brain'
  | 'hand'
  | 'learning'
  | 'mouth'
  | 'context_compaction'
  | 'search'

export type AssistantProcessVariant =
  | 'brain_placeholder'
  | 'brain_thought'
  | 'hand_tool'
  | 'learning_skill'
  | 'mouth_summary'
  | 'context_compaction'
  | 'search_placeholder'

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

export type AssistantToolDetail = {
  label: string
  value: string
}

export type AssistantProcessIconKind =
  | 'brain'
  | 'search'
  | 'terminal'
  | 'document'
  | 'search-doc'
  | 'edit'
  | 'learning'
  | 'mouth'
  | 'compaction'
  | 'default'

export type AssistantBaseProcessItem = {
  id: string
  nodeKind: AssistantProcessNodeKind
  variant: AssistantProcessVariant
  text: string
  status: AssistantProcessStatus
  isCurrent: boolean
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
  iconKind: AssistantProcessIconKind
  details: AssistantToolDetail[]
  toolName?: AssistantToolName
  skillId?: RuntimeSkillId
}

export type AssistantProcessItem = AssistantBaseProcessItem

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

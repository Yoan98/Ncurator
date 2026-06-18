import type { ReactNode } from 'react'
import type {
  AiRunEvent,
  AiFileChangeStatus,
  RuntimeSkillId,
  SearchResult,
  WorkspaceSource
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

export type WorkbenchSelectOption = {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  keywords?: string[]
  trailing?: ReactNode
  disabled?: boolean
}

export type WorkspaceQuickSelectProps = {
  workspaces: WorkspaceSource[]
  selectedWorkspaceId: string | null
  onWorkspaceChange: (workspaceId: string) => void
  onEmptyAction?: () => void
  placeholder?: string
  className?: string
  noDrag?: boolean
  'data-testid'?: string
}

export type WorkspaceQuickSelectPopupPosition = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
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
  isDirectory?: boolean
}

export type AssistantProcessStatus = 'running' | 'completed' | 'failed'

export type AssistantProcessSourceEventType = 'thinking' | AiRunEvent['type']

export type AssistantRichTextSegment = {
  text: string
  emphasis?: boolean
  iconKind?: AssistantProcessIconKind
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
  | 'finalizing'
  | 'default'

export type AssistantProcessGroupKind =
  | 'thinking'
  | 'skill'
  | 'learning'
  | 'compaction'
  | 'finalizing'

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
  targetLabel?: string
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

export type AssistantProcessThought = {
  id: string
  text: string
  createdAt: number
  sourceEventType: Extract<AiRunEvent['type'], 'assistant_process_thought'>
}

export type FileChangeWorkspaceTab = {
  fileKey: string
  applyId: string
  fileName: string
  sourcePath: string
  changeCount: number
  status: AiFileChangeStatus
  unseen: boolean
}

export type AssistantTurnApplyTarget = {
  changeId: string
  title: string
  changeCount: number
  status?: AiFileChangeStatus
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
  processThoughts: AssistantProcessThought[]
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
      backTarget?: WorkbenchContentPanelState
    }
  | {
      kind: 'apply_workspace'
      title: string
      tabs: FileChangeWorkspaceTab[]
      activeFileKey: string | null
    }
  | {
      kind: 'browser'
      title: string
    }

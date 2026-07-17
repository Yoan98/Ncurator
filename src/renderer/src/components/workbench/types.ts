import type { ReactNode } from 'react'
import type {
  AiPreference,
  AiRunEvent,
  AiFileChangeStatus,
  IpcJsonObject,
  RuntimeSkillId,
  SearchResult,
  WorkbenchModelSelection,
  WorkspaceSource
} from '../../../../shared/types'

export type WorkbenchMode = 'ai' | 'search'
export type WorkbenchAiPreference = AiPreference

export type WorkbenchPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type WorkbenchModelPreference = WorkbenchModelSelection

export type WorkbenchContextUsage = {
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
}

export type WorkbenchSelectOption = {
  value: string
  label: string
  triggerLabel?: string
  triggerIcon?: ReactNode
  triggerSuffix?: ReactNode
  icon?: ReactNode
  description?: string
  keywords?: string[]
  trailing?: ReactNode
  disabled?: boolean
  children?: WorkbenchSelectOption[]
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
  format?: 'docx' | 'pptx'
  pageNumber?: number
  isDirectory?: boolean
}

export type AssistantProcessStatus = 'running' | 'completed' | 'failed' | 'partial_failed'

export type AssistantProcessSourceEventType = 'thinking' | AiRunEvent['type']

export type AssistantRichTextSegment = {
  text: string
  emphasis?: boolean
  iconKind?: AssistantProcessIconKind
}

export type AssistantToolName =
  | 'terminal_run'
  | 'terminal_read'
  | 'terminal_stop'
  | 'text_file_read'
  | 'text_file_edit'
  | 'kb_search'
  | 'kb_list_documents'
  | 'docx_read_outline'
  | 'docx_search'
  | 'docx_read_blocks'
  | 'docx_edit'
  | 'pdf_inspect'
  | 'pdf_search'
  | 'pdf_read_pages'
  | 'pdf_render_pages'
  | 'ppt_read_outline'
  | 'ppt_read_slides'
  | 'ppt_search'
  | 'ppt_render_slides'
  | 'ppt_edit'
  | 'web_search'
  | 'web_crawl'
  | 'browser_use'
  | 'image_analyze'
  | 'wait_time'
  | 'unnamed'

export type AssistantProcessIconKind =
  | 'search'
  | 'browser'
  | 'wait'
  | 'web'
  | 'image'
  | 'knowledge'
  | 'workflow'
  | 'terminal'
  | 'document'
  | 'edit'
  | 'retry'
  | 'learning'
  | 'compaction'
  | 'finalizing'
  | 'default'

export type AssistantProcessGroupKind =
  | 'thinking'
  | 'skill'
  | 'retry'
  | 'learning'
  | 'compaction'
  | 'finalizing'

export type AssistantProcessSkillKey =
  | 'docx-read'
  | 'docx-edit'
  | 'file-read'
  | 'file-edit'
  | 'pdf-read'
  | 'ppt'
  | 'kb'
  | 'terminal'
  | 'web-search'
  | 'web-crawl'
  | 'browser'
  | 'image-recognition'
  | 'wait'
  | 'generic'

export type AssistantProcessGroupItem = {
  id: string
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  partialFailedText: AssistantRichTextSegment[]
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
  toolName?: AssistantToolName
  targetLabel?: string
  input?: IpcJsonObject
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
  partialFailedText: AssistantRichTextSegment[]
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

export type AssistantTurnApplyTarget = {
  changeId: string
  title: string
  sourcePath?: string
  operation?: 'created' | 'updated' | 'deleted' | 'renamed'
  changeCount: number
  insertCount: number
  deleteCount: number
  status?: AiFileChangeStatus
}

export type AssistantTurnBlocker = {
  kind: 'approval' | 'workspace' | 'user_takeover'
  title: string
  description: string
}

export type AssistantArtifactItem = WorkbenchFileRef & {
  operation?: 'created' | 'updated' | 'deleted' | 'renamed'
}

export type AssistantTurnViewModel = {
  messageId: string
  runId?: string
  status: 'running' | 'completed' | 'failed'
  runFinished: boolean
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
      kind: 'file_launcher'
      title: string
    }
  | {
      kind: 'apply_workspace'
      title: string
      applyId: string | null
    }
  | {
      kind: 'browser'
      title: string
      browserTabId: string
    }

export type WorkbenchResourceTab = {
  id: string
  kind: 'file' | 'browser'
  title: string
  filePath?: string
  browserTabId?: string
  state: Extract<
    WorkbenchContentPanelState,
    { kind: 'file_preview' | 'file_launcher' | 'apply_workspace' | 'browser' }
  >
}

export type WorkbenchTabWorkspaceState = {
  tabs: WorkbenchResourceTab[]
  activeTabId: string | null
}

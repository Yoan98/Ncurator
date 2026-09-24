import type { ReactNode } from 'react'
import type {
  AiPreference,
  AiExecutionPermission,
  AiRunEvent,
  AiFileChangeStatus,
  IpcJsonObject,
  RuntimeSkillId
} from '../../../../shared/types'
import type { RuntimeToolName } from '../../../../shared/runtimeCapabilities'

export type WorkbenchAiPreference = AiPreference
export type WorkbenchExecutionPermission = AiExecutionPermission

export type WorkbenchContextUsage = {
  partnerId: string
  contextWindowTokens: number
  usedContextTokens: number
  ratio: number
  updatedAt: number
  hasEffectiveImageContext: boolean
}

export type WorkbenchSelectOption = {
  value: string
  label: string
  triggerLabel?: string
  triggerIcon?: ReactNode
  triggerSuffix?: ReactNode
  icon?: ReactNode
  description?: string
  labelClassName?: string
  descriptionClassName?: string
  keywords?: string[]
  trailing?: ReactNode
  disabled?: boolean
  /** Shown via Tooltip when the option is disabled (hover). */
  disabledReason?: string
  children?: WorkbenchSelectOption[]
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
  /** Dynamic tool argument (path/command/query/url). Omitted from Activity header short text. */
  param?: boolean
}

export type AssistantToolName = RuntimeToolName | 'unnamed'

export type AssistantProcessIconKind =
  | 'search'
  | 'browser'
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
  | 'eye'
  | 'camera'
  | 'scroll'
  | 'extract'
  | 'window'
  | 'fetch'
  | 'question'
  | 'default'

export type AssistantProcessGroupKind =
  | 'thinking'
  | 'skill'
  | 'retry'
  | 'compaction'
  | 'learning'
  | 'finalizing'

export type AssistantProcessSkillKey =
  | 'docx-read'
  | 'docx-edit'
  | 'file-read'
  | 'file-edit'
  | 'pdf-read'
  | 'ppt-read'
  | 'ppt-search'
  | 'ppt-edit'
  | 'excel-read'
  | 'excel-edit'
  | 'kb'
  | 'terminal'
  | 'web-search'
  | 'browser'
  | 'image-generation'
  | 'image-read'
  | 'learning'
  | 'generic'

export type AssistantProcessGroupItem = {
  id: string
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  partialFailedText: AssistantRichTextSegment[]
  /** Standalone Activity header verb phrase; not derived by stripping expand-row params. */
  headerShortText?: string
  createdAt: number
  sourceEventType: AssistantProcessSourceEventType
  toolName?: AssistantToolName
  targetLabel?: string
  input?: IpcJsonObject
  interaction?: {
    questions: Array<{
      id: string
      question: string
      options: Array<{ id: string; label: string; description?: string; recommended?: boolean }>
      multiSelect?: boolean
    }>
    answers?: Array<{
      questionId: string
      selectedOptionIds: string[]
      userText?: string
    }>
  }
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

export type AssistantArtifactItem = WorkbenchFileRef & {
  operation?: 'created' | 'updated' | 'deleted' | 'renamed'
}

export type AssistantTurnViewModel = {
  messageId: string
  runId?: string
  startedAt?: number
  finishedAt?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  runFinished: boolean
  isBrainThinking?: boolean
  processThoughts: AssistantProcessThought[]
  processGroups: AssistantProcessGroup[]
  finalAnswerMarkdown: string
  /** Present after delivery access checks; undefined while streaming. */
  linkAccess?: import('../../../../shared/types').MarkdownLinkAccessEntry[]
  streamingRoundId?: string
  streamingMarkdown: string
  streamingRole: 'answer' | 'thought'
  plan: import('../../../../shared/types').ChatMessageLogPlanItem[]
  artifacts: AssistantArtifactItem[]
  applyTargets: AssistantTurnApplyTarget[]
  waitingApproval: boolean
  waitingInteraction: boolean
  pendingApprovalItems: import('../../../../shared/types').AiApprovalBatchItem[]
  approvalReviews: import('../../../../shared/workbench/approvalReview').AssistantApprovalReview[]
  error?: string
  /** Provider/internal raw detail for “查看详情”; keep bubble on `error` title only. */
  errorDetail?: string
}

export type WorkbenchContentPanelState =
  | {
      kind: 'empty'
      title: string
      description: string
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
  panelCollapsed: boolean
}

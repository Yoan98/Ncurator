import type {
  AiDraftReviewRef,
  AiPlanTask,
  AiRunEvent,
  DocumentRecord,
  IpcJsonValue,
  JsonValue,
  SearchResult
} from '../../../shared/types'

export type WorkbenchMode = 'ai' | 'search'

export type SearchWorkbenchTurn = {
  query: string
  results: SearchResult[]
  tokens: string[]
  createdAt: number
}

export type WorkbenchToolResultEvent = Extract<AiRunEvent, { type: 'tool_call_result' }>
export type WorkbenchArtifactEvent = Extract<AiRunEvent, { type: 'file_artifact' }>
export type WorkbenchHumanStepEvent = Extract<AiRunEvent, { type: 'human_step' }>
export type WorkbenchTaskDeliveryEvent = Extract<AiRunEvent, { type: 'task_delivery_ready' }>
export type WorkbenchApprovalEvent = Extract<AiRunEvent, { type: 'approval_required' }>
export type WorkbenchWorkspaceEvent = Extract<AiRunEvent, { type: 'workspace_required' }>
export type WorkbenchRuntimeIssueEvent = Extract<AiRunEvent, { type: 'runtime_issue' }>

export type WorkbenchInspector =
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
      kind: 'docs'
      title: string
      data: DocumentRecord[]
    }
  | {
      kind: 'plan'
      title: string
      items: AiPlanTask[]
    }
  | {
      kind: 'tool_result'
      title: string
      event: WorkbenchToolResultEvent
    }
  | {
      kind: 'human_step'
      title: string
      event: WorkbenchHumanStepEvent
    }
  | {
      kind: 'task_delivery'
      title: string
      event: WorkbenchTaskDeliveryEvent
    }
  | {
      kind: 'artifact'
      title: string
      event: WorkbenchArtifactEvent
      related: WorkbenchArtifactEvent[]
    }
  | {
      kind: 'approval'
      title: string
      event: WorkbenchApprovalEvent
    }
  | {
      kind: 'workspace'
      title: string
      event: WorkbenchWorkspaceEvent
    }
  | {
      kind: 'runtime_issue'
      title: string
      event: WorkbenchRuntimeIssueEvent
    }
  | {
      kind: 'draft_review'
      title: string
      review: AiDraftReviewRef
    }
  | {
      kind: 'json'
      title: string
      data: AiRunEvent | JsonValue | IpcJsonValue
    }

export type WorkbenchTimelineItem = {
  id: string
  kind:
    | 'search'
    | 'plan'
    | 'tool'
    | 'human_step'
    | 'task_delivery'
    | 'artifact'
    | 'approval'
    | 'workspace'
    | 'runtime_issue'
    | 'draft_review'
    | 'local_status'
  title: string
  description: string
  badge?: string
  createdAt: number
  inspector: WorkbenchInspector
}

export type WorkbenchProjection = {
  timeline: WorkbenchTimelineItem[]
  defaultSelectedId?: string
}

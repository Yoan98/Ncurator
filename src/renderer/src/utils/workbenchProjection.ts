import type { AiPlanTask, AiRunEvent, DocumentRecord, SearchResult } from '../../../shared/types'
import type {
  SearchWorkbenchTurn,
  WorkbenchArtifactEvent,
  WorkbenchInspector,
  WorkbenchProjection,
  WorkbenchTaskDeliveryEvent,
  WorkbenchTimelineItem,
  WorkbenchToolResultEvent
} from '../types/workbench'

const isSearchResults = (value: WorkbenchToolResultEvent['outputPreview']): value is SearchResult[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === 'object' &&
        'document_name' in item &&
        'text' in item
    )
  )
}

const isDocumentRecords = (
  value: WorkbenchToolResultEvent['outputPreview']
): value is DocumentRecord[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Boolean(item) &&
        typeof item === 'object' &&
        'name' in item &&
        'created_at' in item
    )
  )
}

const getEventTimestamp = (event: AiRunEvent, fallback: number): number => {
  if ('createdAt' in event && typeof event.createdAt === 'number') return event.createdAt
  if ('completedAt' in event && typeof event.completedAt === 'number') return event.completedAt
  if ('decidedAt' in event && typeof event.decidedAt === 'number') return event.decidedAt
  return fallback
}

const humanizeToolName = (toolName: string): string => {
  const labelMap: Record<string, string> = {
    kb_hybrid_search_chunks: '本地混合检索',
    kb_vector_search_chunks: '向量检索',
    kb_fts_search_chunks: '全文检索',
    kb_list_documents: '资料列表',
    docx_open: '打开文档',
    docx_outline: '阅读目录',
    docx_get_block: '阅读文档块',
    docx_search: '搜索文档',
    docx_apply_ops: '编辑文档',
    docx_get_history: '查看草稿历史',
    docx_rollback: '回滚草稿',
    docx_render_preview: '生成预览',
    docx_validate: '校验草稿'
  }
  return labelMap[toolName] || toolName
}

const describeToolResult = (event: WorkbenchToolResultEvent): string => {
  if (event.error) return event.error
  if (isSearchResults(event.outputPreview)) {
    return `${event.outputPreview.length} 条命中`
  }
  if (isDocumentRecords(event.outputPreview)) {
    return `${event.outputPreview.length} 个资料项`
  }
  if (event.toolName === 'docx_apply_ops') {
    const output = event.outputPreview
    if (output && typeof output === 'object' && 'changedCount' in output) {
      const value = output.changedCount
      if (typeof value === 'number') return `已修改 ${value} 处内容`
    }
  }
  if (event.toolName === 'docx_render_preview') {
    return '已生成草稿预览'
  }
  if (event.draftRef?.draftSnapshotId) {
    return `关联草稿 ${event.draftRef.draftSnapshotId.slice(0, 8)}`
  }
  return '工具返回结果'
}

const buildToolInspector = (event: WorkbenchToolResultEvent): WorkbenchInspector => {
  if (isSearchResults(event.outputPreview)) {
    return {
      kind: 'search_results',
      title: `工具结果 · ${humanizeToolName(event.toolName)}`,
      query: event.toolName,
      results: event.outputPreview,
      tokens: []
    }
  }
  if (isDocumentRecords(event.outputPreview)) {
    return {
      kind: 'docs',
      title: `工具结果 · ${humanizeToolName(event.toolName)}`,
      data: event.outputPreview
    }
  }
  return {
    kind: 'tool_result',
    title: `工具结果 · ${humanizeToolName(event.toolName)}`,
    event
  }
}

const pushTimelineItem = (
  timeline: WorkbenchTimelineItem[],
  item: WorkbenchTimelineItem
): void => {
  timeline.push(item)
}

const resolveDeliveryTitle = (
  event: WorkbenchTaskDeliveryEvent,
  plan: AiPlanTask[]
): { title: string; badge: string } => {
  if (event.taskId === 'direct-human') {
    return { title: 'Direct Human 交付', badge: 'final' }
  }
  if (event.taskId === 'synthesis-human') {
    return { title: 'Synthesis 交付', badge: 'synthesis' }
  }
  const matched = plan.find((item) => item.id === event.taskId)
  if (!matched) {
    return { title: `任务交付 · ${event.taskId}`, badge: 'delivery' }
  }
  return { title: `任务交付 · ${matched.title}`, badge: 'delivery' }
}

export const projectWorkbenchState = (input: {
  aiEvents: AiRunEvent[]
  aiPlan: AiPlanTask[]
  searchTurn: SearchWorkbenchTurn | null
}): WorkbenchProjection => {
  const timeline: WorkbenchTimelineItem[] = []
  const runStartedAt =
    input.aiEvents.find((event) => event.type === 'run_started')?.createdAt ||
    input.searchTurn?.createdAt ||
    0

  if (input.searchTurn) {
    pushTimelineItem(timeline, {
      id: `search-${input.searchTurn.createdAt}`,
      kind: 'search',
      title: '本地搜索结果',
      description: `${input.searchTurn.results.length} 条命中`,
      badge: 'search',
      createdAt: input.searchTurn.createdAt,
      inspector: {
        kind: 'search_results',
        title: '搜索结果',
        query: input.searchTurn.query,
        results: input.searchTurn.results,
        tokens: input.searchTurn.tokens
      }
    })
  }

  if (input.aiPlan.length > 0) {
    pushTimelineItem(timeline, {
      id: 'plan-current',
      kind: 'plan',
      title: '当前计划',
      description: `${input.aiPlan.filter((item) => item.status === 'completed').length}/${input.aiPlan.length} 已完成`,
      badge: 'plan',
      createdAt: runStartedAt,
      inspector: {
        kind: 'plan',
        title: '执行计划',
        items: input.aiPlan
      }
    })
  }

  const artifactBucket: WorkbenchArtifactEvent[] = []
  input.aiEvents.forEach((event, index) => {
    if (event.internal) return
    const fallbackTime = runStartedAt + index + 1

    if (event.type === 'file_artifact') {
      artifactBucket.push(event)
      pushTimelineItem(timeline, {
        id: `artifact-${event.artifactId}`,
        kind: 'artifact',
        title: event.fileName,
        description: event.summary,
        badge: event.artifactRole || 'artifact',
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'artifact',
          title: event.fileName,
          event,
          related: [...artifactBucket]
        }
      })
      return
    }

    if (event.type === 'tool_call_result') {
      pushTimelineItem(timeline, {
        id: `tool-${event.toolCallId}-${index}`,
        kind: 'tool',
        title: humanizeToolName(event.toolName),
        description: describeToolResult(event),
        badge: 'tool',
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: buildToolInspector(event)
      })
      return
    }

    if (event.type === 'human_step') {
      pushTimelineItem(timeline, {
        id: `human-step-${event.taskId}-${event.stepIndex}`,
        kind: 'human_step',
        title: event.toolName ? humanizeToolName(event.toolName) : event.summary,
        description: event.publicNarrative,
        badge: event.resultStatus || 'step',
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'human_step',
          title: '执行步骤',
          event
        }
      })
      return
    }

    if (event.type === 'task_delivery_ready') {
      const deliveryMeta = resolveDeliveryTitle(event, input.aiPlan)
      pushTimelineItem(timeline, {
        id: `task-delivery-${event.taskId}-${index}`,
        kind: 'task_delivery',
        title: deliveryMeta.title,
        description: event.summary,
        badge: deliveryMeta.badge,
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'task_delivery',
          title: deliveryMeta.title,
          event
        }
      })
      return
    }

    if (event.type === 'approval_required') {
      pushTimelineItem(timeline, {
        id: `approval-${event.approvalId}`,
        kind: 'approval',
        title: '等待审批',
        description: event.reason,
        badge: event.riskLevel,
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'approval',
          title: '审批请求',
          event
        }
      })
      return
    }

    if (event.type === 'workspace_required') {
      pushTimelineItem(timeline, {
        id: `workspace-${event.taskId}-${index}`,
        kind: 'workspace',
        title: '需要工作区',
        description: event.reason,
        badge: 'workspace',
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'workspace',
          title: '工作区要求',
          event
        }
      })
      return
    }

    if (event.type === 'runtime_issue') {
      pushTimelineItem(timeline, {
        id: `runtime-${event.code}-${index}`,
        kind: 'runtime_issue',
        title: '运行阻塞',
        description: event.message,
        badge: event.code,
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'runtime_issue',
          title: '运行问题',
          event
        }
      })
      return
    }

    if (event.type === 'watchdog_signal') {
      pushTimelineItem(timeline, {
        id: `watchdog-${event.level}-${index}`,
        kind: 'watchdog',
        title: 'Watchdog 提示',
        description: event.summary,
        badge: event.level,
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'watchdog',
          title: 'Watchdog 监督',
          event
        }
      })
      return
    }

    if (event.type === 'draft_review_ready') {
      pushTimelineItem(timeline, {
        id: `draft-review-${event.review.reviewId}`,
        kind: 'draft_review',
        title: '草稿审阅已就绪',
        description: `${event.review.documentCount} 个文档，${event.review.changeCount} 处修改`,
        badge: 'review',
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'draft_review',
          title: '草稿审阅',
          review: event.review
        }
      })
      return
    }

    if (event.type === 'local_sources_status') {
      pushTimelineItem(timeline, {
        id: `local-status-${index}`,
        kind: 'local_status',
        title: '本地资料状态',
        description: event.summary,
        badge: event.status,
        createdAt: getEventTimestamp(event, fallbackTime),
        inspector: {
          kind: 'json',
          title: '本地资料状态',
          data: event
        }
      })
    }
  })

  return {
    timeline,
    defaultSelectedId: timeline.at(-1)?.id
  }
}

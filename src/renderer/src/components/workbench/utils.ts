import type {
  AiRunEvent,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  LlmRemoteModel,
  RuntimeSkillId,
  SearchResult,
  WorkspaceSource
} from '../../../../shared/types'
import {
  WORKBENCH_PREFERENCE_MODE_STORAGE_KEY,
  WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY,
  WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY
} from './constants'
import type {
  AssistantToolDetail,
  AssistantToolName,
  AssistantProcessItem,
  WorkbenchFileRef,
  WorkbenchMode,
  WorkbenchModelPreference,
  WorkbenchPreferenceStorage
} from './types'

const getPageNumberFromMetadata = (metadata: SearchResult['metadata']): number | undefined => {
  if (!metadata) return undefined
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { page?: number }
      return typeof parsed.page === 'number' ? parsed.page : undefined
    } catch {
      return undefined
    }
  }
  return typeof metadata.page === 'number' ? metadata.page : undefined
}

const isIpcJsonObject = (value: IpcJsonValue): value is IpcJsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isWorkbenchMode = (value: string | null): value is WorkbenchMode =>
  value === 'ai' || value === 'search'

const readStringField = (value: IpcJsonObject, key: string): string | undefined => {
  const record = value as Record<string, IpcJsonValue>
  const candidate = record[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined
}

const readNestedObject = (value: IpcJsonObject, key: string): IpcJsonObject | undefined => {
  const record = value as Record<string, IpcJsonValue>
  const candidate = record[key]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : undefined
}

const isAssistantToolName = (toolName: string): toolName is AssistantToolName =>
  toolName === 'terminal_run' ||
  toolName === 'kb_search' ||
  toolName === 'kb_list_documents' ||
  toolName === 'docx_outline' ||
  toolName === 'docx_search' ||
  toolName === 'docx_read_blocks' ||
  toolName === 'docx_history' ||
  toolName === 'docx_edit' ||
  toolName === 'docx_rollback' ||
  toolName === 'unnamed'

const normalizeToolName = (toolName: string): AssistantToolName =>
  isAssistantToolName(toolName) ? toolName : 'unnamed'

const getEventTimestamp = (event: AiRunEvent): number =>
  'createdAt' in event
    ? event.createdAt
    : 'completedAt' in event
      ? event.completedAt
      : 'decidedAt' in event
        ? event.decidedAt
        : Date.now()

const getSkillDisplayName = (skillId?: RuntimeSkillId): string => {
  if (skillId === 'terminal') return '跑指令能力'
  if (skillId === 'kb-retrieval') return '资料检索能力'
  if (skillId === 'docx-read' || skillId === 'docx-write') return '文档处理能力'
  return '新能力'
}

const readStringValue = (value: IpcJsonObject, key: string): string | undefined => {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

const readNumberValue = (value: IpcJsonObject, key: string): number | undefined => {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

const readFirstStringValue = (value: IpcJsonObject, keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = readStringValue(value, key)
    if (candidate) return candidate
  }
  return undefined
}

const addToolDetail = (
  details: AssistantToolDetail[],
  label: string,
  value: string | number | undefined
): void => {
  const text = String(value ?? '').trim()
  if (!text) return
  details.push({ label, value: text })
}

const readDocxReadRange = (input: IpcJsonObject): string | undefined => {
  const from =
    readNumberValue(input, 'fromBlockIndex') ??
    readNumberValue(input, 'fromIndex') ??
    readNumberValue(input, 'startIndex')
  const to =
    readNumberValue(input, 'toBlockIndex') ??
    readNumberValue(input, 'toIndex') ??
    readNumberValue(input, 'endIndex')
  if (typeof from === 'number' && typeof to === 'number') return `${from} - ${to}`
  if (typeof from === 'number') return `从 ${from} 开始`
  if (typeof to === 'number') return `到 ${to} 结束`
  return undefined
}

const readDocxEditActionTypes = (input: IpcJsonObject): string | undefined => {
  const actions = (input as Record<string, IpcJsonValue>).actions
  if (!Array.isArray(actions)) return undefined
  const actionTypes = actions
    .map((action) =>
      action && typeof action === 'object' && !Array.isArray(action)
        ? readStringValue(action, 'type')
        : undefined
    )
    .filter((actionType): actionType is string => Boolean(actionType))
  return actionTypes.length > 0 ? actionTypes.join('、') : undefined
}

const buildToolDetails = (
  toolName: AssistantToolName,
  input: IpcJsonObject
): AssistantToolDetail[] => {
  const details: AssistantToolDetail[] = []
  if (toolName === 'kb_search') {
    addToolDetail(details, '查询词', readFirstStringValue(input, ['queryText', 'query']))
    addToolDetail(details, '策略', readStringValue(input, 'strategy') || 'auto')
    return details
  }
  if (toolName === 'kb_list_documents') {
    addToolDetail(details, '过滤词', readFirstStringValue(input, ['sourceNameQuery', 'query']))
    addToolDetail(
      details,
      '分页',
      `第 ${readNumberValue(input, 'page') ?? 1} 页，每页 ${readNumberValue(input, 'pageSize') ?? 5} 条`
    )
    return details
  }
  if (toolName === 'terminal_run') {
    addToolDetail(details, '命令', readStringValue(input, 'command'))
    addToolDetail(details, 'cwd', readStringValue(input, 'cwd'))
    return details
  }
  if (toolName === 'docx_search') {
    addToolDetail(details, '目标文件', readFirstStringValue(input, ['sourcePath', 'path']))
    addToolDetail(details, '查询词', readFirstStringValue(input, ['query', 'queryText', 'keyword']))
    return details
  }
  if (
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_outline' ||
    toolName === 'docx_history'
  ) {
    addToolDetail(details, '文件名', readFirstStringValue(input, ['sourcePath', 'path']))
    addToolDetail(details, '读取范围', readDocxReadRange(input) || '默认范围')
    return details
  }
  if (toolName === 'docx_edit') {
    addToolDetail(details, '目标文件', readFirstStringValue(input, ['sourcePath', 'path']))
    addToolDetail(details, '操作类型', readDocxEditActionTypes(input))
    return details
  }
  if (toolName === 'docx_rollback') {
    addToolDetail(details, '目标文件', readFirstStringValue(input, ['sourcePath', 'path']))
    addToolDetail(details, '操作类型', 'rollback')
  }
  return details
}

const getToolIconKind = (toolName: AssistantToolName) => {
  if (toolName === 'terminal_run') return 'terminal' as const
  if (toolName === 'docx_edit' || toolName === 'docx_rollback') return 'edit' as const
  if (toolName === 'kb_search' || toolName === 'docx_search') return 'search-doc' as const
  if (
    toolName === 'kb_list_documents' ||
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_history'
  ) {
    return 'document' as const
  }
  return 'default' as const
}

const getToolStatusText = (
  toolName: AssistantToolName,
  status: 'active' | 'completed' | 'failed'
): string => {
  if (toolName === 'kb_search') {
    if (status === 'active') return '俺正在搜索知识库线索'
    if (status === 'completed') return '已完成搜索知识库线索'
    return '搜索知识库线索失败了'
  }
  if (toolName === 'kb_list_documents') {
    if (status === 'active') return '俺正在查看知识库资料'
    if (status === 'completed') return '已完成查看知识库资料'
    return '查看知识库资料失败了'
  }
  if (toolName === 'terminal_run') {
    if (status === 'active') return '俺正在跑指令'
    if (status === 'completed') return '已完成跑指令'
    return '跑指令失败了'
  }
  if (toolName === 'docx_search') {
    if (status === 'active') return '俺正在文档里查找内容'
    if (status === 'completed') return '已完成文档内容查找'
    return '文档内容查找失败了'
  }
  if (toolName === 'docx_read_blocks') {
    if (status === 'active') return '俺正在读取文档内容'
    if (status === 'completed') return '已完成文档内容读取'
    return '文档内容读取失败了'
  }
  if (toolName === 'docx_outline') {
    if (status === 'active') return '俺正在查看文档结构'
    if (status === 'completed') return '已完成文档结构查看'
    return '文档结构查看失败了'
  }
  if (toolName === 'docx_history') {
    if (status === 'active') return '俺正在查看文档历史'
    if (status === 'completed') return '已完成文档历史查看'
    return '文档历史查看失败了'
  }
  if (toolName === 'docx_edit') {
    if (status === 'active') return '俺正在编辑文档'
    if (status === 'completed') return '已完成文档编辑'
    return '文档编辑失败了'
  }
  if (toolName === 'docx_rollback') {
    if (status === 'active') return '俺正在回退文档修改'
    if (status === 'completed') return '已完成文档修改回退'
    return '文档修改回退失败了'
  }
  if (status === 'active') return '未命名'
  if (status === 'completed') return '已完成未命名步骤'
  return '未命名步骤失败了'
}

const getLearningStatusText = (
  skillId: RuntimeSkillId | undefined,
  status: 'active' | 'completed' | 'failed'
): string => {
  const skillName = getSkillDisplayName(skillId)
  if (status === 'active') return `俺在学习${skillName}`
  if (status === 'completed') return `已学会${skillName}`
  return `学习${skillName}失败了`
}

const getMouthStatusText = (status: 'active' | 'completed' | 'failed'): string => {
  if (status === 'active') return '让俺收尾下'
  if (status === 'completed') return '已完成收尾总结'
  return '收尾总结失败了'
}

const getCompactionStatusText = (status: 'active' | 'completed' | 'failed'): string => {
  if (status === 'active') return '让俺整理下，东西太多'
  if (status === 'completed') return '已整理好上下文'
  return '上下文整理失败了'
}

const buildProcessItem = (input: {
  id: string
  nodeKind: AssistantProcessItem['nodeKind']
  variant: AssistantProcessItem['variant']
  status: AssistantProcessItem['status']
  isCurrent: boolean
  createdAt: number
  sourceEventType: AssistantProcessItem['sourceEventType']
  iconKind: AssistantProcessItem['iconKind']
  text?: string
  details?: AssistantToolDetail[]
  toolName?: AssistantToolName
  skillId?: RuntimeSkillId
}): AssistantProcessItem => ({
  id: input.id,
  nodeKind: input.nodeKind,
  variant: input.variant,
  text: input.text || '',
  status: input.status,
  isCurrent: input.isCurrent,
  createdAt: input.createdAt,
  sourceEventType: input.sourceEventType,
  iconKind: input.iconKind,
  details: input.details || [],
  toolName: input.toolName,
  skillId: input.skillId
})

const applyProcessItemState = (
  item: AssistantProcessItem,
  status: AssistantProcessItem['status'],
  isCurrent: boolean
): AssistantProcessItem => {
  if (item.variant === 'hand_tool') {
    return {
      ...item,
      status,
      isCurrent,
      text: getToolStatusText(item.toolName || 'unnamed', status)
    }
  }
  if (item.variant === 'learning_skill') {
    return {
      ...item,
      status,
      isCurrent,
      text: getLearningStatusText(item.skillId, status)
    }
  }
  if (item.variant === 'mouth_summary') {
    return {
      ...item,
      status,
      isCurrent,
      text: getMouthStatusText(status)
    }
  }
  if (item.variant === 'context_compaction') {
    return {
      ...item,
      status,
      isCurrent,
      text: getCompactionStatusText(status)
    }
  }
  return {
    ...item,
    status,
    isCurrent
  }
}

const removeCurrentBrainPlaceholders = (items: AssistantProcessItem[]): AssistantProcessItem[] =>
  items.filter((item) => !(item.variant === 'brain_placeholder' && item.isCurrent))

const settleCurrentItemsForNextBrain = (items: AssistantProcessItem[]): AssistantProcessItem[] =>
  items
    .filter((item) => item.variant !== 'brain_placeholder')
    .map((item) =>
      item.isCurrent
        ? applyProcessItemState(
            item,
            item.status === 'failed'
              ? 'failed'
              : item.status === 'completed'
                ? 'completed'
                : 'completed',
            false
          )
        : item
    )

const clearCurrentFlags = (items: AssistantProcessItem[]): AssistantProcessItem[] =>
  items
    .filter((item) => item.variant !== 'brain_placeholder')
    .map((item) => (item.isCurrent ? applyProcessItemState(item, item.status, false) : item))

const upsertProcessItem = (
  items: AssistantProcessItem[],
  next: AssistantProcessItem
): AssistantProcessItem[] => {
  const existing = items.find((item) => item.id === next.id)
  const merged =
    existing && existing.details.length > 0 && next.details.length === 0
      ? { ...next, details: existing.details }
      : next
  return [...items.filter((item) => item.id !== next.id), merged].sort(
    (left, right) => left.createdAt - right.createdAt
  )
}

const createBrainPlaceholderFromEvent = (event: AiRunEvent): AssistantProcessItem =>
  buildProcessItem({
    id: `${event.runId}:brain:${getEventTimestamp(event)}`,
    nodeKind: 'brain',
    variant: 'brain_placeholder',
    status: 'active',
    isCurrent: true,
    createdAt: getEventTimestamp(event),
    sourceEventType: event.type,
    iconKind: 'brain',
    text: '让俺想想'
  })

const createSearchPlaceholderItem = (messageId: string): AssistantProcessItem =>
  buildProcessItem({
    id: `${messageId}:search`,
    nodeKind: 'search',
    variant: 'search_placeholder',
    status: 'active',
    isCurrent: true,
    createdAt: Date.now(),
    sourceEventType: 'thinking',
    iconKind: 'search',
    text: '让俺找找'
  })

const createBrainThoughtItem = (
  event: Extract<AiRunEvent, { type: 'human_step' }>
): AssistantProcessItem =>
  buildProcessItem({
    id: `${event.taskId}:brain:${event.stepIndex}`,
    nodeKind: 'brain',
    variant: 'brain_thought',
    status: event.resultStatus === 'error' ? 'failed' : 'active',
    isCurrent: true,
    createdAt: event.createdAt,
    sourceEventType: event.type,
    iconKind: 'brain',
    text: event.publicNarrative.trim() || event.summary || '俺在判断下一步怎么做'
  })

const createLearningItem = (
  event: Extract<AiRunEvent, { type: 'human_step' }>
): AssistantProcessItem =>
  buildProcessItem({
    id: `${event.taskId}:learning:${event.stepIndex}:${event.skillId || 'unknown'}`,
    nodeKind: 'learning',
    variant: 'learning_skill',
    status: event.resultStatus === 'error' ? 'failed' : 'active',
    isCurrent: true,
    createdAt: event.createdAt,
    sourceEventType: event.type,
    iconKind: 'learning',
    text: getLearningStatusText(
      event.skillId,
      event.resultStatus === 'error' ? 'failed' : 'active'
    ),
    skillId: event.skillId
  })

const createMouthItem = (
  event: Extract<AiRunEvent, { type: 'human_step' }>
): AssistantProcessItem =>
  buildProcessItem({
    id: `${event.taskId}:mouth:${event.stepIndex}`,
    nodeKind: 'mouth',
    variant: 'mouth_summary',
    status: event.resultStatus === 'error' ? 'failed' : 'active',
    isCurrent: event.resultStatus !== 'error',
    createdAt: event.createdAt,
    sourceEventType: event.type,
    iconKind: 'mouth',
    text: getMouthStatusText(event.resultStatus === 'error' ? 'failed' : 'active')
  })

const createHandToolItem = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' | 'tool_call_result' }>
): AssistantProcessItem => {
  const toolName = normalizeToolName(event.toolName)
  const status =
    event.type === 'tool_call_result'
      ? event.error || event.result?.ok === false
        ? 'failed'
        : 'completed'
      : 'active'
  return buildProcessItem({
    id: event.toolCallId,
    nodeKind: 'hand',
    variant: 'hand_tool',
    status,
    isCurrent: event.type === 'tool_call_started',
    createdAt: getEventTimestamp(event),
    sourceEventType: event.type,
    iconKind: getToolIconKind(toolName),
    text: getToolStatusText(toolName, status),
    details: event.type === 'tool_call_started' ? buildToolDetails(toolName, event.input) : [],
    toolName
  })
}

const createCompactionItem = (
  event: Extract<
    AiRunEvent,
    { type: 'context_compaction_started' | 'context_compaction_completed' }
  >
): AssistantProcessItem =>
  buildProcessItem({
    id: `${event.runId}:context-compaction`,
    nodeKind: 'context_compaction',
    variant: 'context_compaction',
    status: event.type === 'context_compaction_completed' ? 'completed' : 'active',
    isCurrent: event.type === 'context_compaction_started',
    createdAt: getEventTimestamp(event),
    sourceEventType: event.type,
    iconKind: 'compaction',
    text: getCompactionStatusText(
      event.type === 'context_compaction_completed' ? 'completed' : 'active'
    )
  })

const createFileRefFromObject = (
  item: IpcJsonObject,
  origin: WorkbenchFileRef['origin']
): WorkbenchFileRef | null => {
  const nestedDocument = readNestedObject(item, 'document')
  const path =
    readStringField(item, 'path') ||
    readStringField(item, 'file_path') ||
    readStringField(item, 'absolute_path') ||
    readStringField(item, 'source_path') ||
    (nestedDocument ? readStringField(nestedDocument, 'file_path') : undefined)
  const fileName =
    readStringField(item, 'fileName') ||
    readStringField(item, 'file_name') ||
    readStringField(item, 'name') ||
    readStringField(item, 'document_name') ||
    (nestedDocument ? readStringField(nestedDocument, 'name') : undefined)

  if (!path || !fileName) return null
  return {
    path,
    fileName,
    origin,
    summary: readStringField(item, 'summary')
  }
}

export const getAssistantToolNarrative = (toolName?: string): string =>
  getToolStatusText(normalizeToolName(String(toolName || '')), 'active')

export const buildAssistantProcessText = (event: AiRunEvent): string | null => {
  if (event.type === 'human_step') {
    if (event.stage === 'human_learning' || event.action === 'learn_skill') {
      return getLearningStatusText(
        event.skillId,
        event.resultStatus === 'error' ? 'failed' : 'active'
      )
    }
    if (event.stage === 'human_mouth' || event.action === 'deliver_result') {
      return getMouthStatusText(event.resultStatus === 'error' ? 'failed' : 'active')
    }
    if (event.stage === 'human_brain') {
      return event.publicNarrative.trim() || event.summary || '俺在判断下一步怎么做'
    }
    return null
  }
  if (event.type === 'tool_call_started' || event.type === 'tool_call_result') {
    return getToolStatusText(
      normalizeToolName(event.toolName),
      event.type === 'tool_call_started'
        ? 'active'
        : event.error || event.result?.ok === false
          ? 'failed'
          : 'completed'
    )
  }
  if (
    event.type === 'context_compaction_started' ||
    event.type === 'context_compaction_completed'
  ) {
    return getCompactionStatusText(
      event.type === 'context_compaction_started' ? 'active' : 'completed'
    )
  }
  return null
}

export const createAssistantPlaceholderItem = (
  messageId: string,
  text = '让俺想下'
): AssistantProcessItem =>
  text === '让俺找找'
    ? createSearchPlaceholderItem(messageId)
    : buildProcessItem({
        id: `${messageId}:brain`,
        nodeKind: 'brain',
        variant: 'brain_placeholder',
        status: 'active',
        isCurrent: true,
        createdAt: Date.now(),
        sourceEventType: 'thinking',
        iconKind: 'brain',
        text
      })

export const createAssistantThinkingItem = (messageId: string): AssistantProcessItem =>
  createAssistantPlaceholderItem(messageId)

export const createAssistantProcessItem = (
  event: AiRunEvent,
  options?: { id?: string; text?: string }
): AssistantProcessItem | null => {
  if (event.type === 'human_step') {
    if (event.stage === 'human_hand') return null
    if (event.stage === 'human_learning' || event.action === 'learn_skill') {
      const learningItem = createLearningItem(event)
      return options?.text ? { ...learningItem, text: options.text } : learningItem
    }
    if (event.stage === 'human_mouth' || event.action === 'deliver_result') {
      const mouthItem = createMouthItem(event)
      return options?.text ? { ...mouthItem, text: options.text } : mouthItem
    }
    const thoughtItem = createBrainThoughtItem(event)
    return options?.text ? { ...thoughtItem, text: options.text } : thoughtItem
  }
  if (event.type === 'tool_call_started' || event.type === 'tool_call_result') {
    const toolItem = createHandToolItem(event)
    return options?.text ? { ...toolItem, text: options.text } : toolItem
  }
  if (
    event.type === 'context_compaction_started' ||
    event.type === 'context_compaction_completed'
  ) {
    const compactionItem = createCompactionItem(event)
    return options?.text ? { ...compactionItem, text: options.text } : compactionItem
  }
  return null
}

export const reduceAssistantProcessItems = (
  current: AssistantProcessItem[],
  event: AiRunEvent
): AssistantProcessItem[] => {
  if (event.type === 'human_step') {
    if (event.stage === 'human_hand') return current
    if (event.stage === 'human_brain') {
      const next = createBrainThoughtItem(event)
      return upsertProcessItem(
        removeCurrentBrainPlaceholders(settleCurrentItemsForNextBrain(current)),
        next
      )
    }
    if (event.stage === 'human_learning' || event.action === 'learn_skill') {
      return upsertProcessItem(current, createLearningItem(event))
    }
    if (event.stage === 'human_mouth' || event.action === 'deliver_result') {
      const currentHasCompletedMouth = current.some(
        (item) => item.nodeKind === 'mouth' && item.status === 'completed'
      )
      if (currentHasCompletedMouth) return current
      return upsertProcessItem(removeCurrentBrainPlaceholders(current), createMouthItem(event))
    }
    return current
  }

  if (event.type === 'tool_call_started') {
    return upsertProcessItem(current, createHandToolItem(event))
  }

  if (event.type === 'tool_call_result') {
    const withCompletedTool = upsertProcessItem(current, createHandToolItem(event))
    const settled = settleCurrentItemsForNextBrain(withCompletedTool)
    return upsertProcessItem(settled, createBrainPlaceholderFromEvent(event))
  }

  if (event.type === 'context_compaction_started') {
    return upsertProcessItem(current, createCompactionItem(event))
  }

  if (event.type === 'context_compaction_completed') {
    const withCompletedCompaction = upsertProcessItem(current, createCompactionItem(event))
    const settled = settleCurrentItemsForNextBrain(withCompletedCompaction)
    return upsertProcessItem(settled, createBrainPlaceholderFromEvent(event))
  }

  if (event.type === 'answer_token') {
    const nextItems = removeCurrentBrainPlaceholders(current)
    const hasActiveMouth = nextItems.some(
      (item) => item.nodeKind === 'mouth' && item.status === 'active'
    )
    if (hasActiveMouth) return nextItems
    return upsertProcessItem(
      nextItems,
      buildProcessItem({
        id: `${event.runId}:mouth`,
        nodeKind: 'mouth',
        variant: 'mouth_summary',
        status: 'active',
        isCurrent: true,
        createdAt: Date.now(),
        sourceEventType: event.type,
        iconKind: 'mouth',
        text: getMouthStatusText('active')
      })
    )
  }

  if (event.type === 'answer_completed') {
    return current
      .filter((item) => item.variant !== 'brain_placeholder')
      .map((item) =>
        item.nodeKind === 'mouth' ? applyProcessItemState(item, 'completed', false) : item
      )
  }

  if (
    event.type === 'run_failed' ||
    event.type === 'runtime_issue' ||
    event.type === 'run_cancelled'
  ) {
    return clearCurrentFlags(current)
  }

  return current
}

export const mergeAssistantProcessItem = (
  current: AssistantProcessItem[],
  next: AssistantProcessItem
): AssistantProcessItem[] => upsertProcessItem(current, next)

export const dedupeFileRefs = (items: WorkbenchFileRef[]): WorkbenchFileRef[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.origin}:${item.path}:${item.applyId || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const getSearchResultFileRef = (result: SearchResult): WorkbenchFileRef | null => {
  const path = result.document?.file_path
  if (!path) return null
  return {
    path,
    fileName: result.document_name,
    origin: result.source_type === 'web' ? 'artifact' : 'search_hit',
    pageNumber: getPageNumberFromMetadata(result.metadata)
  }
}

export const extractReadableFilesFromToolOutput = (
  output: IpcJsonValue,
  fallbackOrigin: WorkbenchFileRef['origin']
): WorkbenchFileRef[] => {
  if (Array.isArray(output)) {
    const refs = (output as IpcJsonArray)
      .map((item) => (isIpcJsonObject(item) ? createFileRefFromObject(item, fallbackOrigin) : null))
      .filter((item): item is WorkbenchFileRef => item !== null)
    return dedupeFileRefs(refs)
  }
  if (isIpcJsonObject(output)) {
    const single = createFileRefFromObject(output, fallbackOrigin)
    return single ? [single] : []
  }
  return []
}

export const extractSearchResultsFromToolOutput = (output: IpcJsonValue): SearchResult[] => {
  if (!Array.isArray(output)) return []
  return output
    .filter((item): item is IpcJsonObject => isIpcJsonObject(item))
    .map((item) => {
      const nestedDocument = readNestedObject(item, 'document')
      const result: SearchResult = {
        id: readStringField(item, 'id') || crypto.randomUUID(),
        text: readStringField(item, 'text') || '',
        document_name:
          readStringField(item, 'document_name') || readStringField(item, 'name') || '未命名文档',
        document_id: readStringField(item, 'document_id'),
        source_type: readStringField(item, 'source_type'),
        document: nestedDocument
          ? {
              id: readStringField(nestedDocument, 'id') || '',
              name: readStringField(nestedDocument, 'name') || '',
              source_type:
                readStringField(nestedDocument, 'source_type') === 'web' ? 'web' : 'file',
              file_path: readStringField(nestedDocument, 'file_path'),
              created_at: 0,
              import_status: 2
            }
          : undefined
      }
      return result
    })
    .filter((item) => item.text || item.document_name)
}

export const formatSessionDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export const readWorkbenchModePreference = (storage: WorkbenchPreferenceStorage): WorkbenchMode => {
  const stored = storage.getItem(WORKBENCH_PREFERENCE_MODE_STORAGE_KEY)
  return isWorkbenchMode(stored) ? stored : 'ai'
}

export const writeWorkbenchModePreference = (
  storage: WorkbenchPreferenceStorage,
  mode: WorkbenchMode
): void => {
  storage.setItem(WORKBENCH_PREFERENCE_MODE_STORAGE_KEY, mode)
}

export const readWorkbenchWorkspacePreference = (
  storage: WorkbenchPreferenceStorage
): string | null => {
  const stored = storage.getItem(WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY)
  return stored && stored.trim() ? stored : null
}

export const writeWorkbenchWorkspacePreference = (
  storage: WorkbenchPreferenceStorage,
  workspaceId: string | null
): void => {
  if (!workspaceId) {
    storage.removeItem(WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY)
    return
  }
  storage.setItem(WORKBENCH_PREFERENCE_WORKSPACE_STORAGE_KEY, workspaceId)
}

export const resolveWorkbenchWorkspaceSelection = (
  workspaces: WorkspaceSource[],
  preferredWorkspaceId: string | null
): string | null => {
  if (
    preferredWorkspaceId &&
    workspaces.some((workspace) => workspace.id === preferredWorkspaceId)
  ) {
    return preferredWorkspaceId
  }
  return workspaces[0]?.id || null
}

export const readWorkbenchModelPreference = (
  storage: WorkbenchPreferenceStorage
): WorkbenchModelPreference | null => {
  const raw = storage.getItem(WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { configId?: string; modelName?: string }
    if (!parsed.configId || !parsed.modelName) return null
    return {
      configId: parsed.configId,
      modelName: parsed.modelName
    }
  } catch {
    return null
  }
}

export const writeWorkbenchModelPreference = (
  storage: WorkbenchPreferenceStorage,
  preference: WorkbenchModelPreference | null
): void => {
  if (!preference) {
    storage.removeItem(WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY)
    return
  }
  storage.setItem(WORKBENCH_PREFERENCE_MODEL_STORAGE_KEY, JSON.stringify(preference))
}

export const resolveWorkbenchModelSelection = (input: {
  configId: string
  models: LlmRemoteModel[]
  defaultModelName?: string | null
  preference: WorkbenchModelPreference | null
}): string | null => {
  const { configId, defaultModelName, models, preference } = input
  const preferredModelName =
    preference?.configId === configId ? preference.modelName : defaultModelName || null
  if (preferredModelName && models.some((model) => model.id === preferredModelName)) {
    return preferredModelName
  }
  if (
    defaultModelName &&
    preferredModelName !== defaultModelName &&
    models.some((model) => model.id === defaultModelName)
  ) {
    return defaultModelName
  }
  return models[0]?.id || null
}

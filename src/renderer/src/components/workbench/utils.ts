import type {
  AiRunEvent,
  AssistantProcessDisplay,
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
  AssistantProcessGroup,
  AssistantProcessGroupItem,
  AssistantProcessThought,
  AssistantProcessIconKind,
  AssistantProcessSkillKey,
  AssistantProcessStatus,
  AssistantRichTextSegment,
  AssistantToolName,
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

const text = (
  value: string,
  emphasis = false,
  iconKind?: AssistantProcessIconKind
): AssistantRichTextSegment => ({
  text: value,
  emphasis,
  iconKind
})

const sentence = (...segments: AssistantRichTextSegment[]): AssistantRichTextSegment[] => segments

const plainText = (segments: AssistantRichTextSegment[]): string =>
  segments.map((segment) => segment.text).join('')

const readStringValue = (value: IpcJsonObject, key: string): string | undefined => {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

const readFirstStringValue = (value: IpcJsonObject, keys: string[]): string | undefined => {
  for (const key of keys) {
    const candidate = readStringValue(value, key)
    if (candidate) return candidate
  }
  return undefined
}

const truncateMiddle = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value
  const keep = Math.max(8, Math.floor((maxLength - 1) / 2))
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

const readToolFileLabel = (input?: IpcJsonObject): string => {
  if (!input) return '目标'
  return (
    readFirstStringValue(input, [
      'fileName',
      'file_name',
      'sourceName',
      'source_name',
      'sourcePath',
      'source_path',
      'path',
      'filePath',
      'file_path'
    ]) || '目标'
  )
}

const readToolQueryLabel = (input?: IpcJsonObject): string => {
  if (!input) return '相关内容'
  return (
    readFirstStringValue(input, ['queryText', 'query', 'keyword', 'sourceNameQuery']) || '相关内容'
  )
}

const readCommandLabel = (input?: IpcJsonObject): string => {
  if (!input) return '一条本地命令'
  const command = readStringValue(input, 'command')
  return command ? truncateMiddle(command, 96) : '一条本地命令'
}

const readDocxRangeLabel = (input?: IpcJsonObject): string => {
  if (!input) return '细节'
  const candidate = (input as Record<string, IpcJsonValue>)['range']
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '细节'
  const range = candidate as Record<string, IpcJsonValue>
  if (
    range.type === 'block_index' &&
    typeof range.fromBlockIndex === 'number' &&
    typeof range.toBlockIndex === 'number'
  ) {
    return `${String(range.fromBlockIndex)}-${String(range.toBlockIndex)} 区间`
  }
  if (range.type === 'block_ids') return '指定区间'
  return '细节'
}

const getSkillDisplayName = (skillId?: RuntimeSkillId): string => {
  if (skillId === 'terminal') return '命令执行器'
  if (skillId === 'kb-retrieval') return '资料查阅器'
  if (skillId === 'docx-read') return 'docx 阅读器'
  if (skillId === 'docx-write') return 'docx 写作器'
  return '新能力'
}

const getToolSkillKey = (toolName: AssistantToolName): AssistantProcessSkillKey => {
  if (
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_history' ||
    toolName === 'docx_search'
  ) {
    return 'docx-reader'
  }
  if (toolName === 'docx_edit' || toolName === 'docx_rollback') return 'docx-writer'
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return 'reference-reader'
  if (toolName === 'terminal_run') return 'terminal-runner'
  return 'generic-task'
}

const getDisplaySkillKey = (display: AssistantProcessDisplay): AssistantProcessSkillKey => {
  if (display.kind === 'tool') return getToolSkillKey(normalizeToolName(display.toolName))
  return 'generic-task'
}

const getSkillIconKind = (skillKey: AssistantProcessSkillKey): AssistantProcessIconKind => {
  if (skillKey === 'docx-writer') return 'edit'
  if (skillKey === 'docx-reader') return 'document'
  if (skillKey === 'reference-reader') return 'search'
  if (skillKey === 'terminal-runner') return 'terminal'
  return 'default'
}

const getDisplayIconKind = (display: AssistantProcessDisplay): AssistantProcessIconKind => {
  if (display.kind === 'thinking') return 'default'
  if (display.kind === 'learning') return 'learning'
  if (display.kind === 'compaction') return 'compaction'
  if (display.kind === 'finalizing') return 'finalizing'
  return getSkillIconKind(getDisplaySkillKey(display))
}

const getSkillHeaderText = (
  skillKey: AssistantProcessSkillKey,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (skillKey === 'docx-reader') {
    if (status === 'running') return sentence(text('俺正在阅读 '), text('docx', true))
    if (status === 'completed') return sentence(text('俺已阅读完 '), text('docx', true))
    return sentence(text('阅读 '), text('docx', true), text(' 失败了'))
  }
  if (skillKey === 'docx-writer') {
    if (status === 'running') return sentence(text('俺正在写 '), text('docx', true))
    if (status === 'completed') return sentence(text('俺已写完 '), text('docx', true))
    return sentence(text('写 '), text('docx', true), text(' 失败了'))
  }
  if (skillKey === 'reference-reader') {
    if (status === 'running') return sentence(text('俺正在查阅资料'))
    if (status === 'completed') return sentence(text('俺已查阅完资料'))
    return sentence(text('查阅资料失败了'))
  }
  if (skillKey === 'terminal-runner') {
    if (status === 'running') return sentence(text('正在跑神秘代码'))
    if (status === 'completed') return sentence(text('已跑完神秘代码'))
    return sentence(text('跑神秘代码失败了'))
  }
  if (status === 'running') return sentence(text('俺正在处理任务'))
  if (status === 'completed') return sentence(text('俺已处理完任务'))
  return sentence(text('处理任务失败了'))
}

const buildToolNarrative = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] => {
  const fileLabel = readToolFileLabel(input)
  const queryLabel = readToolQueryLabel(input)
  const commandLabel = readCommandLabel(input)

  if (toolName === 'docx_outline') {
    if (status === 'running') {
      return sentence(text('正在阅读 '), text(fileLabel, true), text(' 文件的结构'))
    }
    if (status === 'completed') {
      return sentence(text('已阅读 '), text(fileLabel, true), text(' 文件的结构'))
    }
    return sentence(text('阅读 '), text(fileLabel, true), text(' 文件的结构失败了'))
  }
  if (toolName === 'docx_read_blocks') {
    const rangeText = readDocxRangeLabel(input)
    const targetText = rangeText === '细节' ? ' 文件细节' : ` 文件的 ${rangeText}`
    if (status === 'running') {
      return sentence(text('正在读取 '), text(fileLabel, true), text(targetText))
    }
    if (status === 'completed') {
      return sentence(text('已读取 '), text(fileLabel, true), text(targetText))
    }
    return sentence(text('读取 '), text(fileLabel, true), text(`${targetText}失败了`))
  }
  if (toolName === 'docx_edit') {
    if (status === 'running')
      return sentence(text('正在编辑 '), text(fileLabel, true), text(' 文件'))
    if (status === 'completed')
      return sentence(text('已编辑 '), text(fileLabel, true), text(' 文件'))
    return sentence(text('编辑 '), text(fileLabel, true), text(' 文件失败了'))
  }
  if (toolName === 'docx_history') {
    if (status === 'running') {
      return sentence(text('正在检查 '), text(fileLabel, true), text(' 文件的修改历史'))
    }
    if (status === 'completed') {
      return sentence(text('已检查 '), text(fileLabel, true), text(' 文件的修改历史'))
    }
    return sentence(text('检查 '), text(fileLabel, true), text(' 文件的修改历史失败了'))
  }
  if (toolName === 'terminal_run') {
    if (status === 'running') return sentence(text('正在执行 '), text(commandLabel, true))
    if (status === 'completed') return sentence(text('已执行 '), text(commandLabel, true))
    return sentence(text('执行 '), text(commandLabel, true), text(' 失败了'))
  }
  if (toolName === 'kb_search' || toolName === 'docx_search') {
    if (status === 'running') return sentence(text('正在搜索 '), text(queryLabel, true))
    if (status === 'completed') return sentence(text('已搜索 '), text(queryLabel, true))
    return sentence(text('搜索 '), text(queryLabel, true), text(' 失败了'))
  }
  if (toolName === 'kb_list_documents') {
    if (status === 'running') return sentence(text('正在查看资料列表'))
    if (status === 'completed') return sentence(text('已查看资料列表'))
    return sentence(text('查看资料列表失败了'))
  }
  if (status === 'running') return sentence(text('正在处理任务中的一步'))
  if (status === 'completed') return sentence(text('已处理任务中的一步'))
  return sentence(text('这一步没跑通'))
}

const getDisplayGroupText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'thinking') {
    if (status === 'running') return sentence(text('让俺想想'))
    if (status === 'completed') return sentence(text('俺想好了'))
    return sentence(text('俺没想明白'))
  }
  if (display.kind === 'learning') {
    const skillName = getSkillDisplayName(display.skillId)
    if (status === 'running') return sentence(text('正在学习 '), text(skillName, true))
    if (status === 'completed') return sentence(text('已学会 '), text(skillName, true))
    return sentence(text('学习 '), text(skillName, true), text(' 失败了'))
  }
  if (display.kind === 'compaction') {
    if (status === 'running') return sentence(text('东西太多了，让俺整理下'))
    if (status === 'completed') return sentence(text('呼，终于整理好了，累死俺了'))
    return sentence(text('上下文整理失败了'))
  }
  if (display.kind === 'finalizing') {
    if (status === 'running') return sentence(text('基本完成了，让俺收尾下吧'))
    if (status === 'completed') return sentence(text('收尾完成了'))
    return sentence(text('收尾失败了'))
  }
  return getSkillHeaderText(getDisplaySkillKey(display), status)
}

const getDisplayItemText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'tool') {
    return buildToolNarrative(normalizeToolName(display.toolName), status, display.input)
  }
  return getDisplayGroupText(display, status)
}

type ExecutionActionKind = 'docx-read' | 'docx-edit' | 'kb-retrieval' | 'terminal' | 'generic'

type ExecutionActionSummary = {
  kind: ExecutionActionKind
  iconKind: AssistantProcessIconKind
  fileLabels: Set<string>
  count: number
}

const getExecutionActionKind = (toolName?: AssistantToolName): ExecutionActionKind => {
  if (
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_history' ||
    toolName === 'docx_search'
  ) {
    return 'docx-read'
  }
  if (toolName === 'docx_edit' || toolName === 'docx_rollback') return 'docx-edit'
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return 'kb-retrieval'
  if (toolName === 'terminal_run') return 'terminal'
  return 'generic'
}

const getExecutionIconKind = (kind: ExecutionActionKind): AssistantProcessIconKind => {
  if (kind === 'docx-read') return 'document'
  if (kind === 'docx-edit') return 'edit'
  if (kind === 'kb-retrieval') return 'search'
  if (kind === 'terminal') return 'terminal'
  return 'default'
}

const getExecutionStatus = (groups: AssistantProcessGroup[]): AssistantProcessStatus => {
  if (
    groups.some(
      (group) => group.status === 'running' || group.items.some((item) => item.status === 'running')
    )
  ) {
    return 'running'
  }
  if (
    groups.some(
      (group) => group.status === 'failed' || group.items.some((item) => item.status === 'failed')
    )
  ) {
    return 'failed'
  }
  return 'completed'
}

const getExecutionActionOrder = (kind: ExecutionActionKind): number => {
  if (kind === 'docx-read') return 1
  if (kind === 'docx-edit') return 2
  if (kind === 'kb-retrieval') return 3
  if (kind === 'terminal') return 4
  return 5
}

const getExecutionActionText = (
  summary: ExecutionActionSummary,
  status: AssistantProcessStatus
): string => {
  if (summary.kind === 'docx-read') {
    const verb = status === 'completed' ? '已读取' : status === 'failed' ? '读取' : '正在读取'
    return `${verb} ${String(summary.fileLabels.size || summary.count || 1)} 个 docx 文件${
      status === 'failed' ? '失败了' : ''
    }`
  }
  if (summary.kind === 'docx-edit') {
    const verb = status === 'completed' ? '已编辑' : status === 'failed' ? '编辑' : '正在编辑'
    return `${verb} ${String(summary.fileLabels.size || summary.count || 1)} 个 docx 文件${
      status === 'failed' ? '失败了' : ''
    }`
  }
  if (summary.kind === 'kb-retrieval') {
    if (status === 'completed') return '已检索知识库'
    if (status === 'failed') return '检索知识库失败了'
    return '正在检索知识库'
  }
  if (summary.kind === 'terminal') {
    if (status === 'completed') return '已跑完神秘代码'
    if (status === 'failed') return '跑神秘代码失败了'
    return '正在跑神秘代码'
  }
  if (status === 'completed') return '已处理任务'
  if (status === 'failed') return '处理任务失败了'
  return '正在处理任务'
}

export const buildAssistantExecutionSummaryText = (
  groups: AssistantProcessGroup[]
): AssistantRichTextSegment[] => {
  const summaries = new Map<ExecutionActionKind, ExecutionActionSummary>()
  for (const group of groups) {
    const entries =
      group.items.length > 0
        ? group.items.map((item) => ({ toolName: item.toolName, targetLabel: item.targetLabel }))
        : [{ toolName: undefined, targetLabel: undefined }]
    for (const entry of entries) {
      const kind = getExecutionActionKind(entry.toolName)
      const current =
        summaries.get(kind) ||
        ({
          kind,
          iconKind: getExecutionIconKind(kind),
          fileLabels: new Set<string>(),
          count: 0
        } satisfies ExecutionActionSummary)
      current.count += 1
      if (kind === 'docx-read' || kind === 'docx-edit') {
        current.fileLabels.add(entry.targetLabel || group.id)
      }
      summaries.set(kind, current)
    }
  }

  const status = getExecutionStatus(groups)
  const ordered = [...summaries.values()].sort(
    (left, right) => getExecutionActionOrder(left.kind) - getExecutionActionOrder(right.kind)
  )
  if (ordered.length === 0) return sentence(text('正在处理任务', false, 'default'))

  return ordered.flatMap((summary, index) => {
    const prefix = index === 0 ? '' : '，'
    return sentence(
      text(prefix, false),
      text(getExecutionActionText(summary, status), false, summary.iconKind)
    )
  })
}

export const resolveAssistantExecutionStatus = getExecutionStatus

const createProcessGroup = (input: {
  id: string
  kind: AssistantProcessGroup['kind']
  skillKey: AssistantProcessSkillKey
  iconKind: AssistantProcessIconKind
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  items?: AssistantProcessGroupItem[]
  createdAt: number
  sourceEventType: AssistantProcessGroup['sourceEventType']
  skillId?: RuntimeSkillId
}): AssistantProcessGroup => ({
  id: input.id,
  kind: input.kind,
  skillKey: input.skillKey,
  iconKind: input.iconKind,
  status: input.status,
  runningText: input.runningText,
  completedText: input.completedText,
  failedText: input.failedText,
  items: input.items || [],
  createdAt: input.createdAt,
  sourceEventType: input.sourceEventType,
  skillId: input.skillId
})

const resolveGroupStatus = (items: AssistantProcessGroupItem[]): AssistantProcessStatus => {
  if (items.some((item) => item.status === 'running')) return 'running'
  if (items.some((item) => item.status === 'failed')) return 'failed'
  return 'completed'
}

const upsertProcessGroup = (
  groups: AssistantProcessGroup[],
  next: AssistantProcessGroup
): AssistantProcessGroup[] =>
  [...groups.filter((group) => group.id !== next.id), next].sort(
    (left, right) => left.createdAt - right.createdAt
  )

const mergeProcessGroup = (
  groups: AssistantProcessGroup[],
  groupId: string,
  mapper: (group: AssistantProcessGroup) => AssistantProcessGroup
): AssistantProcessGroup[] =>
  groups.map((group) => (group.id === groupId ? mapper(group) : group))

const createDisplayProcessGroup = (input: {
  groupId: string
  kind: AssistantProcessGroup['kind']
  display: AssistantProcessDisplay
  status: AssistantProcessStatus
  createdAt: number
  sourceEventType: AssistantProcessGroup['sourceEventType']
}): AssistantProcessGroup => {
  const skillKey = getDisplaySkillKey(input.display)
  return createProcessGroup({
    id: input.groupId,
    kind: input.kind,
    skillKey,
    iconKind: getDisplayIconKind(input.display),
    status: input.status,
    runningText: getDisplayGroupText(input.display, 'running'),
    completedText: getDisplayGroupText(input.display, 'completed'),
    failedText: getDisplayGroupText(input.display, 'failed'),
    createdAt: input.createdAt,
    sourceEventType: input.sourceEventType,
    skillId: input.display.kind === 'learning' ? input.display.skillId : undefined
  })
}

const createDisplayProcessItem = (input: {
  itemId: string
  display: AssistantProcessDisplay
  status: AssistantProcessStatus
  createdAt: number
  sourceEventType: AssistantProcessGroupItem['sourceEventType']
  existing?: AssistantProcessGroupItem
}): AssistantProcessGroupItem => {
  const toolName =
    input.display.kind === 'tool' ? normalizeToolName(input.display.toolName) : undefined
  return {
    id: input.itemId,
    status: input.status,
    runningText: input.existing?.runningText || getDisplayItemText(input.display, 'running'),
    completedText: input.existing?.completedText || getDisplayItemText(input.display, 'completed'),
    failedText: input.existing?.failedText || getDisplayItemText(input.display, 'failed'),
    createdAt: input.existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType,
    toolName,
    targetLabel:
      input.existing?.targetLabel ||
      (input.display.kind === 'tool' ? readToolFileLabel(input.display.input) : undefined)
  }
}

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
  plainText(
    getSkillHeaderText(getToolSkillKey(normalizeToolName(String(toolName || ''))), 'running')
  )

export const buildAssistantProcessText = (event: AiRunEvent): string | null => {
  if (event.type === 'assistant_process_group_started') {
    return plainText(getDisplayGroupText(event.display, 'running'))
  }
  if (event.type === 'assistant_process_group_completed') {
    return event.display ? plainText(getDisplayGroupText(event.display, 'completed')) : null
  }
  if (event.type === 'assistant_process_group_failed') {
    return event.display ? plainText(getDisplayGroupText(event.display, 'failed')) : null
  }
  if (event.type === 'assistant_process_item_started') {
    return plainText(getDisplayItemText(event.display, 'running'))
  }
  if (event.type === 'assistant_process_item_completed') {
    return event.display ? plainText(getDisplayItemText(event.display, 'completed')) : null
  }
  if (event.type === 'assistant_process_item_failed') {
    return event.display ? plainText(getDisplayItemText(event.display, 'failed')) : null
  }
  return null
}

export const createAssistantThinkingGroup = (messageId: string): AssistantProcessGroup =>
  createProcessGroup({
    id: `${messageId}:thinking`,
    kind: 'thinking',
    skillKey: 'generic-task',
    iconKind: 'default',
    status: 'running',
    runningText: sentence(text('让俺想想')),
    completedText: sentence(text('俺想好了')),
    failedText: sentence(text('俺没想明白')),
    createdAt: Date.now(),
    sourceEventType: 'thinking'
  })

export const createSearchProcessGroup = (messageId: string): AssistantProcessGroup =>
  createProcessGroup({
    id: `${messageId}:search`,
    kind: 'skill',
    skillKey: 'reference-reader',
    iconKind: 'search',
    status: 'running',
    runningText: getSkillHeaderText('reference-reader', 'running'),
    completedText: getSkillHeaderText('reference-reader', 'completed'),
    failedText: getSkillHeaderText('reference-reader', 'failed'),
    createdAt: Date.now(),
    sourceEventType: 'thinking'
  })

export const completeAssistantProcessGroups = (
  groups: AssistantProcessGroup[],
  status: AssistantProcessStatus = 'completed'
): AssistantProcessGroup[] =>
  groups
    .filter((group) => !(status === 'completed' && group.kind === 'finalizing'))
    .map((group) => {
      if (group.status !== 'running') return group
      const nextItems = group.items.map((item) =>
        item.status === 'running' ? { ...item, status } : item
      )
      return {
        ...group,
        status: status === 'failed' ? 'failed' : resolveGroupStatus(nextItems),
        items: nextItems
      }
    })

export const reduceAssistantProcessThoughts = (
  current: AssistantProcessThought[],
  event: AiRunEvent
): AssistantProcessThought[] => {
  if (event.type !== 'assistant_process_thought') return current
  const text = event.text.trim()
  if (!text) return current
  const next: AssistantProcessThought = {
    id: event.thoughtId,
    text,
    createdAt: event.createdAt,
    sourceEventType: event.type
  }
  return [...current.filter((item) => item.id !== next.id), next].sort(
    (left, right) => left.createdAt - right.createdAt
  )
}

const upsertGroupFromDisplayEvent = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    kind: AssistantProcessGroup['kind']
    display: AssistantProcessDisplay
    status: AssistantProcessStatus
    createdAt: number
    sourceEventType: AssistantProcessGroup['sourceEventType']
  }
): AssistantProcessGroup[] => {
  const currentWithoutLocalThinking =
    input.display.kind === 'thinking'
      ? current.filter(
          (group) => !(group.kind === 'thinking' && group.sourceEventType === 'thinking')
        )
      : current
  const existing = currentWithoutLocalThinking.find((group) => group.id === input.groupId)
  const next = createDisplayProcessGroup({
    groupId: input.groupId,
    kind: input.kind,
    display: input.display,
    status: input.status,
    createdAt: existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType
  })
  return upsertProcessGroup(currentWithoutLocalThinking, {
    ...next,
    items: existing?.items || []
  })
}

const completeProcessGroupById = (
  current: AssistantProcessGroup[],
  groupId: string,
  status: AssistantProcessStatus,
  display?: AssistantProcessDisplay
): AssistantProcessGroup[] =>
  mergeProcessGroup(current, groupId, (group) => {
    const nextItems =
      status === 'failed'
        ? group.items.map((item) => (item.status === 'running' ? { ...item, status } : item))
        : group.items
    return {
      ...group,
      status: status === 'completed' && nextItems.length > 0 ? resolveGroupStatus(nextItems) : status,
      runningText: display ? getDisplayGroupText(display, 'running') : group.runningText,
      completedText: display ? getDisplayGroupText(display, 'completed') : group.completedText,
      failedText: display ? getDisplayGroupText(display, 'failed') : group.failedText,
      items: nextItems
    }
  })

const upsertProcessItem = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    itemId: string
    display: AssistantProcessDisplay
    status: AssistantProcessStatus
    createdAt: number
    sourceEventType: AssistantProcessGroupItem['sourceEventType']
  }
): AssistantProcessGroup[] => {
  const existingGroup = current.find((group) => group.id === input.groupId)
  const groupsWithParent = existingGroup
    ? current
    : upsertGroupFromDisplayEvent(current, {
        groupId: input.groupId,
        kind: input.display.kind === 'tool' ? 'skill' : input.display.kind,
        display: input.display,
        status: 'running',
        createdAt: input.createdAt,
        sourceEventType: input.sourceEventType
      })

  return mergeProcessGroup(groupsWithParent, input.groupId, (group) => {
    const existingItem = group.items.find((item) => item.id === input.itemId)
    const nextItem = createDisplayProcessItem({
      itemId: input.itemId,
      display: input.display,
      status: input.status,
      createdAt: input.createdAt,
      sourceEventType: input.sourceEventType,
      existing: existingItem
    })
    return {
      ...group,
      status: 'running',
      items: [...group.items.filter((item) => item.id !== input.itemId), nextItem].sort(
        (left, right) => left.createdAt - right.createdAt
      )
    }
  })
}

const completeProcessItem = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    itemId: string
    status: AssistantProcessStatus
    display?: AssistantProcessDisplay
    sourceEventType: AssistantProcessGroupItem['sourceEventType']
  }
): AssistantProcessGroup[] =>
  mergeProcessGroup(current, input.groupId, (group) => {
    const nextItems = group.items.map((item) => {
      if (item.id !== input.itemId) return item
      return {
        ...item,
        status: input.status,
        completedText: input.display
          ? getDisplayItemText(input.display, 'completed')
          : item.completedText,
        failedText: input.display ? getDisplayItemText(input.display, 'failed') : item.failedText,
        sourceEventType: input.sourceEventType
      }
    })
    return {
      ...group,
      status: resolveGroupStatus(nextItems),
      items: nextItems
    }
  })

export const reduceAssistantProcessGroups = (
  current: AssistantProcessGroup[],
  event: AiRunEvent
): AssistantProcessGroup[] => {
  if (event.type === 'assistant_process_thought') {
    if (!event.text.trim()) return current
    return current.filter((group) => group.kind !== 'thinking')
  }

  if (event.type === 'assistant_process_group_started') {
    return upsertGroupFromDisplayEvent(current, {
      groupId: event.groupId,
      kind: event.kind,
      display: event.display,
      status: 'running',
      createdAt: event.createdAt,
      sourceEventType: event.type
    })
  }

  if (event.type === 'assistant_process_group_completed') {
    if (event.groupId.endsWith(':thinking') || event.groupId.endsWith(':finalizing')) {
      return current.filter((group) => group.id !== event.groupId)
    }
    return completeProcessGroupById(current, event.groupId, 'completed', event.display)
  }

  if (event.type === 'assistant_process_group_failed') {
    return completeProcessGroupById(current, event.groupId, 'failed', event.display)
  }

  if (event.type === 'assistant_process_item_started') {
    return upsertProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      display: event.display,
      status: 'running',
      createdAt: event.createdAt,
      sourceEventType: event.type
    })
  }

  if (event.type === 'assistant_process_item_completed') {
    return completeProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      status: 'completed',
      display: event.display,
      sourceEventType: event.type
    })
  }

  if (event.type === 'assistant_process_item_failed') {
    return completeProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      status: 'failed',
      display: event.display,
      sourceEventType: event.type
    })
  }

  if (
    event.type === 'run_failed' ||
    event.type === 'runtime_issue' ||
    event.type === 'run_cancelled'
  ) {
    return completeAssistantProcessGroups(current, 'failed')
  }

  return current
}

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

export const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (hours < 1) {
    return '刚刚'
  }
  if (hours < 24) {
    return `${hours}小时`
  }
  return `${days}天`
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

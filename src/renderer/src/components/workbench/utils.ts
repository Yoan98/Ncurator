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
  toolName === 'web_crawl' ||
  toolName === 'browser_use' ||
  toolName === 'wait_time' ||
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
  if (!input) return '目标文件'
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
    ]) || '目标文件'
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

const readWebUrlLabel = (input?: IpcJsonObject): string => {
  if (!input) return '网页'
  const url = readStringValue(input, 'url')
  return url ? truncateMiddle(url, 96) : '网页'
}

const readInstructionLabel = (input?: IpcJsonObject): string => {
  if (!input) return '当前页面'
  const instruction = readStringValue(input, 'instruction')
  return instruction ? truncateMiddle(instruction, 96) : '当前页面'
}

const readWaitDurationLabel = (input?: IpcJsonObject): string => {
  if (!input) return '一段时间'
  const seconds = (input as Record<string, IpcJsonValue>).seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return `${String(seconds)} 秒`
  if (typeof seconds === 'string' && seconds.trim()) return `${seconds.trim()} 秒`
  return '一段时间'
}

const readDocxRangeLabel = (input?: IpcJsonObject): string => {
  if (!input) return '内容'
  const candidate = (input as Record<string, IpcJsonValue>)['range']
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '内容'
  const range = candidate as Record<string, IpcJsonValue>
  if (
    range.type === 'block_index' &&
    typeof range.fromBlockIndex === 'number' &&
    typeof range.toBlockIndex === 'number'
  ) {
    return `${String(range.fromBlockIndex)}-${String(range.toBlockIndex)} 区间`
  }
  if (range.type === 'block_ids') return '指定区间'
  return '内容'
}

const getSkillDisplayName = (skillId?: RuntimeSkillId): string => {
  if (skillId === 'terminal') return '命令执行器'
  if (skillId === 'kb-retrieval') return '资料查阅器'
  if (skillId === 'docx-read') return 'docx 阅读器'
  if (skillId === 'docx-write') return 'docx 写作器'
  return '新能力'
}

const getToolUiKind = (toolName?: AssistantToolName): AssistantProcessSkillKey => {
  if (
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_history' ||
    toolName === 'docx_search'
  ) {
    return 'docx-read'
  }
  if (toolName === 'docx_edit') return 'docx-edit'
  if (toolName === 'docx_rollback') return 'docx-rollback'
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return 'kb'
  if (toolName === 'terminal_run') return 'terminal'
  if (toolName === 'web_crawl') return 'web-read'
  if (toolName === 'browser_use') return 'browser'
  if (toolName === 'wait_time') return 'wait'
  return 'generic'
}

const getDisplaySkillKey = (display: AssistantProcessDisplay): AssistantProcessSkillKey => {
  if (display.kind === 'tool') return getToolUiKind(normalizeToolName(display.toolName))
  return 'generic'
}

const getToolIconKind = (skillKey: AssistantProcessSkillKey): AssistantProcessIconKind => {
  if (skillKey === 'docx-edit' || skillKey === 'docx-rollback') return 'edit'
  if (skillKey === 'docx-read') return 'document'
  if (skillKey === 'kb' || skillKey === 'web-read' || skillKey === 'browser') return 'search'
  if (skillKey === 'terminal') return 'terminal'
  return 'default'
}

const getDisplayIconKind = (display: AssistantProcessDisplay): AssistantProcessIconKind => {
  if (display.kind === 'thinking') return 'default'
  if (display.kind === 'learning') return 'learning'
  if (display.kind === 'compaction') return 'compaction'
  if (display.kind === 'finalizing') return 'finalizing'
  return getToolIconKind(getDisplaySkillKey(display))
}

const getToolSummaryText = (
  skillKey: AssistantProcessSkillKey,
  status: AssistantProcessStatus,
  count = 1
): AssistantRichTextSegment[] => {
  const normalizedCount = String(Math.max(1, count))
  if (skillKey === 'docx-read') {
    if (status === 'running') return sentence(text(`正在读取 ${normalizedCount} 个 docx 文件`))
    if (status === 'completed') return sentence(text(`已读取 ${normalizedCount} 个 docx 文件`))
    return sentence(text(`读取 ${normalizedCount} 个 docx 文件失败`))
  }
  if (skillKey === 'docx-edit') {
    if (status === 'running') return sentence(text(`正在编辑 ${normalizedCount} 个 docx 文件`))
    if (status === 'completed') return sentence(text(`已编辑 ${normalizedCount} 个 docx 文件`))
    return sentence(text(`编辑 ${normalizedCount} 个 docx 文件失败`))
  }
  if (skillKey === 'docx-rollback') {
    if (status === 'running')
      return sentence(text(`正在回退 ${normalizedCount} 个 docx 文件的修改`))
    if (status === 'completed')
      return sentence(text(`已回退 ${normalizedCount} 个 docx 文件的修改`))
    return sentence(text(`回退 ${normalizedCount} 个 docx 文件的修改失败`))
  }
  if (skillKey === 'kb') {
    if (status === 'running') return sentence(text('正在检索知识库'))
    if (status === 'completed') return sentence(text('已检索知识库'))
    return sentence(text('检索知识库失败'))
  }
  if (skillKey === 'terminal') {
    if (status === 'running') return sentence(text('正在执行终端指令'))
    if (status === 'completed') return sentence(text('已执行终端指令'))
    return sentence(text('执行终端指令失败'))
  }
  if (skillKey === 'web-read') {
    if (status === 'running') return sentence(text('正在读取网页'))
    if (status === 'completed') return sentence(text('已读取网页'))
    return sentence(text('读取网页失败'))
  }
  if (skillKey === 'browser') {
    if (status === 'running') return sentence(text('正在操作浏览器'))
    if (status === 'completed') return sentence(text('已完成浏览器操作'))
    return sentence(text('浏览器操作失败'))
  }
  if (skillKey === 'wait') {
    if (status === 'running') return sentence(text('正在等待'))
    if (status === 'completed') return sentence(text('已完成等待'))
    return sentence(text('等待失败'))
  }
  if (status === 'running') return sentence(text('正在处理任务'))
  if (status === 'completed') return sentence(text('已处理任务'))
  return sentence(text('处理任务失败'))
}

const getToolItemText = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] => {
  const fileLabel = readToolFileLabel(input)
  const queryLabel = readToolQueryLabel(input)
  const commandLabel = readCommandLabel(input)
  const urlLabel = readWebUrlLabel(input)
  const instructionLabel = readInstructionLabel(input)
  const waitLabel = readWaitDurationLabel(input)

  if (toolName === 'docx_outline') {
    if (status === 'running') {
      return sentence(text('正在阅读 '), text(fileLabel, true), text(' 的结构'))
    }
    if (status === 'completed') {
      return sentence(text('已阅读 '), text(fileLabel, true), text(' 的结构'))
    }
    return sentence(text('阅读 '), text(fileLabel, true), text(' 的结构失败'))
  }
  if (toolName === 'docx_read_blocks') {
    const rangeText = readDocxRangeLabel(input)
    const targetText = ` 的${rangeText}`
    if (status === 'running') {
      return sentence(text('正在读取 '), text(fileLabel, true), text(targetText))
    }
    if (status === 'completed') {
      return sentence(text('已读取 '), text(fileLabel, true), text(targetText))
    }
    return sentence(text('读取 '), text(fileLabel, true), text(`${targetText}失败`))
  }
  if (toolName === 'docx_edit') {
    if (status === 'running') return sentence(text('正在编辑 '), text(fileLabel, true))
    if (status === 'completed') return sentence(text('已编辑 '), text(fileLabel, true))
    return sentence(text('编辑 '), text(fileLabel, true), text(' 失败'))
  }
  if (toolName === 'docx_rollback') {
    if (status === 'running')
      return sentence(text('正在回退 '), text(fileLabel, true), text(' 的修改'))
    if (status === 'completed')
      return sentence(text('已回退 '), text(fileLabel, true), text(' 的修改'))
    return sentence(text('回退 '), text(fileLabel, true), text(' 的修改失败'))
  }
  if (toolName === 'docx_history') {
    if (status === 'running') {
      return sentence(text('正在检查 '), text(fileLabel, true), text(' 的修改历史'))
    }
    if (status === 'completed') {
      return sentence(text('已检查 '), text(fileLabel, true), text(' 的修改历史'))
    }
    return sentence(text('检查 '), text(fileLabel, true), text(' 的修改历史失败'))
  }
  if (toolName === 'terminal_run') {
    if (status === 'running') return sentence(text('正在执行终端指令：'), text(commandLabel, true))
    if (status === 'completed') return sentence(text('已执行终端指令：'), text(commandLabel, true))
    return sentence(text('执行终端指令失败：'), text(commandLabel, true))
  }
  if (toolName === 'kb_search' || toolName === 'docx_search') {
    if (status === 'running') return sentence(text('正在搜索 '), text(queryLabel, true))
    if (status === 'completed') return sentence(text('已搜索 '), text(queryLabel, true))
    return sentence(text('搜索 '), text(queryLabel, true), text(' 失败'))
  }
  if (toolName === 'kb_list_documents') {
    if (status === 'running') return sentence(text('正在查看资料列表'))
    if (status === 'completed') return sentence(text('已查看资料列表'))
    return sentence(text('查看资料列表失败'))
  }
  if (toolName === 'web_crawl') {
    if (status === 'running') return sentence(text('正在读取网页：'), text(urlLabel, true))
    if (status === 'completed') return sentence(text('已读取网页：'), text(urlLabel, true))
    return sentence(text('读取网页失败：'), text(urlLabel, true))
  }
  if (toolName === 'browser_use') {
    if (status === 'running')
      return sentence(text('正在操作浏览器：'), text(instructionLabel, true))
    if (status === 'completed')
      return sentence(text('已完成浏览器操作：'), text(instructionLabel, true))
    return sentence(text('浏览器操作失败：'), text(instructionLabel, true))
  }
  if (toolName === 'wait_time') {
    if (status === 'running') return sentence(text('正在等待 '), text(waitLabel, true))
    if (status === 'completed') return sentence(text('已等待 '), text(waitLabel, true))
    return sentence(text('等待失败'))
  }
  if (status === 'running') return sentence(text('正在处理任务中的一步'))
  if (status === 'completed') return sentence(text('已处理任务中的一步'))
  return sentence(text('这一步处理失败'))
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
  return getToolSummaryText(getDisplaySkillKey(display), status)
}

const getDisplayItemText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'tool') {
    return getToolItemText(normalizeToolName(display.toolName), status, display.input)
  }
  return getDisplayGroupText(display, status)
}

type ExecutionActionSummary = {
  kind: AssistantProcessSkillKey
  iconKind: AssistantProcessIconKind
  fileLabels: Set<string>
  count: number
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

const getExecutionActionOrder = (kind: AssistantProcessSkillKey): number => {
  if (kind === 'docx-read') return 1
  if (kind === 'docx-edit') return 2
  if (kind === 'docx-rollback') return 3
  if (kind === 'kb') return 4
  if (kind === 'terminal') return 5
  if (kind === 'web-read') return 6
  if (kind === 'browser') return 7
  if (kind === 'wait') return 8
  return 9
}

export const buildAssistantExecutionSummaryText = (
  groups: AssistantProcessGroup[]
): AssistantRichTextSegment[] => {
  const summaries = new Map<AssistantProcessSkillKey, ExecutionActionSummary>()
  for (const group of groups) {
    const entries =
      group.items.length > 0
        ? group.items.map((item) => ({ toolName: item.toolName, targetLabel: item.targetLabel }))
        : [{ toolName: undefined, targetLabel: undefined }]
    for (const entry of entries) {
      const kind = getToolUiKind(entry.toolName)
      const current =
        summaries.get(kind) ||
        ({
          kind,
          iconKind: getToolIconKind(kind),
          fileLabels: new Set<string>(),
          count: 0
        } satisfies ExecutionActionSummary)
      current.count += 1
      if (kind === 'docx-read' || kind === 'docx-edit' || kind === 'docx-rollback') {
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
    const count = summary.fileLabels.size || summary.count || 1
    return sentence(
      text(prefix, false),
      ...getToolSummaryText(summary.kind, status, count).map((segment) => ({
        ...segment,
        iconKind: segment.iconKind || summary.iconKind
      }))
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
): AssistantProcessGroup[] => groups.map((group) => (group.id === groupId ? mapper(group) : group))

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
  const isDirectory =
    String(readStringField(item, 'kind') || readStringField(item, 'type') || '').toLowerCase() ===
      'directory' || String(path).endsWith('/')
  return {
    path,
    fileName,
    origin,
    summary: readStringField(item, 'summary'),
    isDirectory
  }
}

export const getAssistantToolNarrative = (toolName?: string): string =>
  plainText(getToolSummaryText(getToolUiKind(normalizeToolName(String(toolName || ''))), 'running'))

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
    skillKey: 'generic',
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
    skillKey: 'kb',
    iconKind: 'search',
    status: 'running',
    runningText: getToolSummaryText('kb', 'running'),
    completedText: getToolSummaryText('kb', 'completed'),
    failedText: getToolSummaryText('kb', 'failed'),
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
  const currentWithoutLocalThinking = current.filter(
    (group) => !(group.kind === 'thinking' && group.sourceEventType === 'thinking')
  )
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
      status:
        status === 'completed' && nextItems.length > 0 ? resolveGroupStatus(nextItems) : status,
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
  const currentWithoutLocalThinking = current.filter(
    (group) => !(group.kind === 'thinking' && group.sourceEventType === 'thinking')
  )
  const existingGroup = currentWithoutLocalThinking.find((group) => group.id === input.groupId)
  const groupsWithParent = existingGroup
    ? currentWithoutLocalThinking
    : upsertGroupFromDisplayEvent(currentWithoutLocalThinking, {
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
    return current
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
  return null
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
  if (defaultModelName && models.length === 0) {
    return defaultModelName
  }
  return models[0]?.id || null
}

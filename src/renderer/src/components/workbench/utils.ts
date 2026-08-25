import type {
  AiRunEvent,
  AssistantProcessDisplay,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  RuntimeSkillId,
  SearchResult
} from '../../../../shared/types'
import {
  RUNTIME_TOOL_CATALOG,
  getRuntimeSkillDisplayName,
  type RuntimeToolName
} from '../../../../shared/runtimeCapabilities'
import {
  getAssistantMixedStatus as getMixedStatus,
  getAssistantToolIconKind as getToolIconKind,
  getAssistantToolSummaryText as getToolSummaryText,
  getAssistantToolUiKind as getToolUiKind
} from '../../../../shared/assistantExecutionSummary'
import type {
  AssistantProcessGroup,
  AssistantProcessGroupItem,
  AssistantProcessThought,
  AssistantProcessIconKind,
  AssistantProcessSkillKey,
  AssistantProcessStatus,
  AssistantRichTextSegment,
  AssistantToolName,
  WorkbenchFileRef
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

const isRuntimeToolName = (toolName: string): toolName is RuntimeToolName =>
  Object.prototype.hasOwnProperty.call(RUNTIME_TOOL_CATALOG, toolName)

const normalizeToolName = (toolName: string): AssistantToolName =>
  isRuntimeToolName(toolName) ? toolName : 'unnamed'

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

export const getAttachmentTypeLabel = (name: string): string => {
  const last = String(name || '')
    .split(/[\\/]/u)
    .pop()
    ?.trim()
  if (!last) return 'FILE'
  const dotIndex = last.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === last.length - 1) return 'FILE'
  const ext = last.slice(dotIndex + 1).trim()
  return ext ? ext.toUpperCase() : 'FILE'
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
      'outputPath',
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
  return skillId ? getRuntimeSkillDisplayName(skillId) || '新能力' : '新能力'
}

const getDisplaySkillKey = (display: AssistantProcessDisplay): AssistantProcessSkillKey => {
  if (display.kind === 'tool') return getToolUiKind(normalizeToolName(display.toolName))
  return 'generic'
}

const getDisplayIconKind = (display: AssistantProcessDisplay): AssistantProcessIconKind => {
  if (display.kind === 'thinking') return 'default'
  if (display.kind === 'learning') return 'learning'
  if (display.kind === 'retry') return 'retry'
  if (display.kind === 'compaction') return 'compaction'
  if (display.kind === 'finalizing') return 'finalizing'
  return getToolIconKind(getDisplaySkillKey(display))
}

type ToolItemRenderer = (input?: IpcJsonObject) => AssistantRichTextSegment[]

const TOOL_ITEM_RENDERERS = {
  terminal_run: (input) => sentence(text('执行命令 '), text(readCommandLabel(input))),
  terminal_read: (input) =>
    sentence(text('读取终端 '), text(readStringValue(input || {}, 'terminalId') || '运行结果')),
  text_file_read: (input) => sentence(text('读取文件 '), text(readToolFileLabel(input))),
  text_file_edit: (input) => sentence(text('编辑文件 '), text(readToolFileLabel(input))),
  kb_search: (input) => sentence(text('在知识库中搜索 '), text(readToolQueryLabel(input))),
  kb_list_documents: () => sentence(text('查看工作空间文档列表')),
  docx_read_outline: (input) =>
    sentence(text('查看文档 '), text(readToolFileLabel(input)), text(' 的结构')),
  docx_search: (input) => sentence(text('在文档中搜索 '), text(readToolQueryLabel(input))),
  docx_read_nodes: (input) =>
    sentence(
      text('读取文档 '),
      text(readToolFileLabel(input)),
      text(` ${readDocxRangeLabel(input)}`)
    ),
  docx_read_visuals: (input) => sentence(text('读取文档视觉内容 '), text(readToolFileLabel(input))),
  docx_content_edit: (input) => sentence(text('编辑文档内容 '), text(readToolFileLabel(input))),
  docx_format: (input) => sentence(text('设置文档格式 '), text(readToolFileLabel(input))),
  docx_table_edit: (input) => sentence(text('编辑文档表格 '), text(readToolFileLabel(input))),
  docx_media_edit: (input) => sentence(text('编辑文档媒体 '), text(readToolFileLabel(input))),
  docx_comments_revisions: (input) =>
    sentence(text('处理文档批注或修订 '), text(readToolFileLabel(input))),
  pdf_inspect: (input) => sentence(text('查看 PDF 信息 '), text(readToolFileLabel(input))),
  pdf_search: (input) => sentence(text('在文档中搜索 '), text(readToolQueryLabel(input))),
  pdf_read_pages: (input) => sentence(text('读取 PDF 页面 '), text(readToolFileLabel(input))),
  pdf_read_visuals: (input) =>
    sentence(text('读取 PDF 页面视觉内容 '), text(readToolFileLabel(input))),
  ppt_read_outline: (input) => sentence(text('阅读 PPT 结构 '), text(readToolFileLabel(input))),
  ppt_read_slides: (input) => sentence(text('读取 PPT 页面 '), text(readToolFileLabel(input))),
  ppt_search: (input) => sentence(text('搜索 PPT '), text(readToolQueryLabel(input))),
  ppt_read_visuals: (input) =>
    sentence(text('读取 PPT 页面视觉内容 '), text(readToolFileLabel(input))),
  ppt_edit: (input) => sentence(text('编辑 PPT '), text(readToolFileLabel(input))),
  excel_read_outline: (input) => sentence(text('查看 Excel 结构 '), text(readToolFileLabel(input))),
  excel_search: (input) => sentence(text('搜索 Excel '), text(readToolQueryLabel(input))),
  excel_read_cells: (input) => sentence(text('读取 Excel 单元格 '), text(readToolFileLabel(input))),
  excel_edit: (input) => sentence(text('编辑 Excel '), text(readToolFileLabel(input))),
  web_search: (input) => {
    const url = readStringValue(input || {}, 'url')
    return url
      ? sentence(text('读取网页 '), text(truncateMiddle(url, 96)))
      : sentence(text('搜索网页 '), text(readToolQueryLabel(input)))
  },
  browser_use: (input) => {
    const action = input ? readStringValue(input, 'action') || '' : ''
    const urlLabel = readWebUrlLabel(input)
    const instructionLabel = readInstructionLabel(input)
    if (action === 'navigate') return sentence(text('打开网页 '), text(urlLabel))
    if (action === 'observe') return sentence(text('查看页面并'), text(instructionLabel))
    if (action === 'extract') return sentence(text('从页面中'), text(instructionLabel))
    if (action === 'act') return sentence(text('在页面上'), text(instructionLabel))
    return sentence(text('操作浏览器 '), text(instructionLabel))
  },
  image_analyze: (input) => sentence(text('识别图片 '), text(readToolFileLabel(input))),
  image_generate: (input) => sentence(text('生成图片 '), text(readToolFileLabel(input))),
  learn_skill: () => sentence(text('学习新技能')),
  update_plan: () => sentence(text('更新任务计划'))
} satisfies Record<RuntimeToolName, ToolItemRenderer>

const getToolItemText = (
  toolName: AssistantToolName,
  _status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] =>
  toolName === 'unnamed' ? sentence(text('处理任务中的一步')) : TOOL_ITEM_RENDERERS[toolName](input)

const getDisplayGroupText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'thinking') {
    if (status === 'running') return sentence(text('让俺想想'))
    if (status === 'completed') return sentence(text('俺想好了'))
    if (status === 'partial_failed') return sentence(text('俺有一部分没想明白'))
    return sentence(text('俺没想明白'))
  }
  if (display.kind === 'learning') {
    const skillName = getSkillDisplayName(display.skillId)
    if (status === 'running') return sentence(text('正在学习 '), text(skillName, true))
    if (status === 'completed') return sentence(text('已学会 '), text(skillName, true))
    if (status === 'partial_failed')
      return sentence(text('学习 '), text(skillName, true), text(' 有部分失败'))
    return sentence(text('学习 '), text(skillName, true), text(' 失败了'))
  }
  if (display.kind === 'retry') {
    const progress = `${display.attempt}/${display.maxAttempts}`
    if (status === 'running') return sentence(text(`正在重试 ${progress}`))
    if (status === 'completed') return sentence(text(`已重试 ${progress}`))
    if (status === 'partial_failed') return sentence(text(`部分重试失败 ${progress}`))
    return sentence(text(`重试失败 ${progress}`))
  }
  if (display.kind === 'compaction') {
    if (status === 'running') return sentence(text('东西太多了，让俺整理下'))
    if (status === 'completed') return sentence(text('呼，终于整理好了，累死俺了'))
    if (status === 'partial_failed') return sentence(text('上下文整理有部分失败'))
    return sentence(text('上下文整理失败了'))
  }
  if (display.kind === 'finalizing') {
    if (status === 'running') return sentence(text('让俺想想'))
    if (status === 'completed') return sentence(text('俺想好了'))
    if (status === 'partial_failed') return sentence(text('俺还有一部分没想明白'))
    return sentence(text('俺没想明白'))
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
  if (display.kind === 'retry') {
    return sentence(text(display.message || ''))
  }
  return getDisplayGroupText(display, status)
}

export {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  resolveAssistantExecutionStatus
} from '../../../../shared/assistantExecutionSummary'

const createProcessGroup = (input: {
  id: string
  kind: AssistantProcessGroup['kind']
  skillKey: AssistantProcessSkillKey
  iconKind: AssistantProcessIconKind
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  partialFailedText: AssistantRichTextSegment[]
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
  partialFailedText: input.partialFailedText,
  items: input.items || [],
  createdAt: input.createdAt,
  sourceEventType: input.sourceEventType,
  skillId: input.skillId
})

const resolveGroupStatus = (items: AssistantProcessGroupItem[]): AssistantProcessStatus => {
  return getMixedStatus(items.map((item) => item.status))
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

export const createDisplayProcessGroup = (input: {
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
    partialFailedText: getDisplayGroupText(input.display, 'partial_failed'),
    createdAt: input.createdAt,
    sourceEventType: input.sourceEventType,
    skillId: input.display.kind === 'learning' ? input.display.skillId : undefined
  })
}

export const createDisplayProcessItem = (input: {
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
    partialFailedText:
      input.existing?.partialFailedText || getDisplayItemText(input.display, 'partial_failed'),
    createdAt: input.existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType,
    toolName,
    input:
      input.existing?.input || (input.display.kind === 'tool' ? input.display.input : undefined),
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
    partialFailedText: sentence(text('俺有一部分没想明白')),
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
    partialFailedText: getToolSummaryText('kb', 'partial_failed'),
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
    (group) =>
      group.kind !== 'thinking' || (input.kind !== 'retry' && group.sourceEventType !== 'thinking')
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
      partialFailedText: display
        ? getDisplayGroupText(display, 'partial_failed')
        : group.partialFailedText,
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
    (group) =>
      group.kind !== 'thinking' ||
      (input.display.kind !== 'retry' && group.sourceEventType !== 'thinking')
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
        partialFailedText: input.display
          ? getDisplayItemText(input.display, 'partial_failed')
          : item.partialFailedText,
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

export const shouldShowAssistantApplyTargets = (input: {
  runFinished: boolean
  applyTargetCount: number
}): boolean => input.runFinished && input.applyTargetCount > 0

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
      const webUrl = readStringField(item, 'url')
      if (webUrl) {
        const title = readStringField(item, 'title') || '未命名网页'
        const text = readStringField(item, 'snippet') || readStringField(item, 'markdown') || ''
        const documentId = readStringField(item, 'requestedUrl') || webUrl
        return {
          id: documentId,
          text,
          document_name: title,
          document_id: documentId,
          source_type: 'web' as const,
          document: {
            id: documentId,
            name: title,
            source_type: 'web' as const,
            file_path: webUrl,
            created_at: 0,
            import_status: 2 as const
          }
        }
      }
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

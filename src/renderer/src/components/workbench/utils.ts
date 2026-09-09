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
  getAssistantToolUiKind as getToolUiKind,
  resolveItemIconKind
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

const param = (value: string): AssistantRichTextSegment => ({
  text: value,
  param: true
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
  return instruction ? truncateMiddle(instruction.replace(/：/gu, ' '), 96) : '当前页面'
}

const readDocxRangeLabel = (input?: IpcJsonObject): string => {
  if (!input) return '内容'
  const candidate = (input as Record<string, IpcJsonValue>)['range']
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '内容'
  const range = candidate as Record<string, IpcJsonValue>
  if (
    range.type === 'node_index' &&
    typeof range.fromNodeIndex === 'number' &&
    typeof range.toNodeIndex === 'number'
  ) {
    return `${String(range.fromNodeIndex)}-${String(range.toNodeIndex)} 区间`
  }
  if (range.type === 'node_ids') return '指定节点'
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
  if (display.kind === 'retry') return 'retry'
  if (display.kind === 'compaction') return 'compaction'
  if (display.kind === 'tool') {
    return resolveItemIconKind({
      toolName: normalizeToolName(display.toolName),
      input: display.input
    })
  }
  return getToolIconKind(getDisplaySkillKey(display))
}

const readLearnSkillNames = (input?: IpcJsonObject): string => {
  if (!input) return '新能力'
  const raw = (input as Record<string, IpcJsonValue>).skillIds
  if (!Array.isArray(raw)) return '新能力'
  const names = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((skillId) => getSkillDisplayName(skillId as RuntimeSkillId))
  return names.length > 0 ? names.join('、') : '新能力'
}

type ToolItemCopy = {
  headerShort: string
  detail: AssistantRichTextSegment[]
}

type ToolItemRenderer = (
  input: IpcJsonObject | undefined,
  status: AssistantProcessStatus
) => ToolItemCopy

const toolCopy = (headerShort: string, detail: AssistantRichTextSegment[]): ToolItemCopy => ({
  headerShort,
  detail
})

const TOOL_ITEM_RENDERERS = {
  terminal_run: (input) =>
    toolCopy('执行命令', sentence(text('执行命令 '), param(readCommandLabel(input)))),
  terminal_read: (input) =>
    toolCopy(
      '读取终端',
      sentence(text('读取终端 '), param(readStringValue(input || {}, 'terminalId') || '运行结果'))
    ),
  text_file_read: (input) =>
    toolCopy('读取文件', sentence(text('读取文件 '), param(readToolFileLabel(input)))),
  text_file_search: (input) =>
    toolCopy('搜索文件', sentence(text('搜索文件 '), param(readToolQueryLabel(input)))),
  text_file_edit: (input) =>
    toolCopy('编辑文件', sentence(text('编辑文件 '), param(readToolFileLabel(input)))),
  kb_search: (input) =>
    toolCopy('在知识库中搜索', sentence(text('在知识库中搜索 '), param(readToolQueryLabel(input)))),
  kb_list_documents: () =>
    toolCopy('查看工作空间文档列表', sentence(text('查看工作空间文档列表'))),
  docx_read_outline: (input) =>
    toolCopy(
      '查看 Word 文档结构',
      sentence(text('查看 Word 文档 '), param(readToolFileLabel(input)), text(' 的结构'))
    ),
  docx_search: (input) =>
    toolCopy(
      '在 Word 文档中搜索',
      sentence(text('在 Word 文档中搜索 '), param(readToolQueryLabel(input)))
    ),
  docx_read_nodes: (input) =>
    toolCopy(
      '读取 Word 文档',
      sentence(
        text('读取 Word 文档 '),
        param(readToolFileLabel(input)),
        param(` ${readDocxRangeLabel(input)}`)
      )
    ),
  docx_content_edit: (input) =>
    toolCopy(
      '编辑 Word 文档内容',
      sentence(text('编辑 Word 文档内容 '), param(readToolFileLabel(input)))
    ),
  docx_format: (input) =>
    toolCopy(
      '设置 Word 文档格式',
      sentence(text('设置 Word 文档格式 '), param(readToolFileLabel(input)))
    ),
  docx_table_edit: (input) =>
    toolCopy(
      '编辑 Word 文档表格',
      sentence(text('编辑 Word 文档表格 '), param(readToolFileLabel(input)))
    ),
  docx_comments_revisions: (input) =>
    toolCopy(
      '处理 Word 文档批注或修订',
      sentence(text('处理 Word 文档批注或修订 '), param(readToolFileLabel(input)))
    ),
  pdf_outline: (input) =>
    toolCopy('查看 PDF 提纲', sentence(text('查看 PDF 提纲 '), param(readToolFileLabel(input)))),
  pdf_search: (input) =>
    toolCopy('在文档中搜索', sentence(text('在文档中搜索 '), param(readToolQueryLabel(input)))),
  pdf_read_pages: (input) =>
    toolCopy('读取 PDF 页面', sentence(text('读取 PDF 页面 '), param(readToolFileLabel(input)))),
  ppt_read_outline: (input) =>
    toolCopy('阅读 PPT 结构', sentence(text('阅读 PPT 结构 '), param(readToolFileLabel(input)))),
  ppt_read_slides: (input) =>
    toolCopy('读取 PPT 页面', sentence(text('读取 PPT 页面 '), param(readToolFileLabel(input)))),
  ppt_search: (input) =>
    toolCopy('搜索 PPT', sentence(text('搜索 PPT '), param(readToolQueryLabel(input)))),
  ppt_edit: (input) =>
    toolCopy('编辑 PPT', sentence(text('编辑 PPT '), param(readToolFileLabel(input)))),
  excel_read: (input) => {
    const type = readStringValue(input || {}, 'type') || ''
    if (type === 'search') {
      return toolCopy('搜索 Excel', sentence(text('搜索 Excel '), param(readToolQueryLabel(input))))
    }
    if (type === 'style') {
      return toolCopy(
        '读取 Excel 样式',
        sentence(text('读取 Excel 样式 '), param(readToolFileLabel(input)))
      )
    }
    if (type === 'range') {
      return toolCopy(
        '读取 Excel 范围',
        sentence(text('读取 Excel 范围 '), param(readToolFileLabel(input)))
      )
    }
    return toolCopy(
      '查看 Excel 结构',
      sentence(text('查看 Excel 结构 '), param(readToolFileLabel(input)))
    )
  },
  excel_edit: (input) =>
    toolCopy('编辑 Excel', sentence(text('编辑 Excel '), param(readToolFileLabel(input)))),
  web_search: (input) => {
    const type = readStringValue(input || {}, 'type')
    if (type === 'fetch') {
      const url = readStringValue(input || {}, 'url')
      return url
        ? toolCopy('抓取网页', sentence(text('抓取网页 '), param(truncateMiddle(url, 96))))
        : toolCopy('抓取网页', sentence(text('抓取网页')))
    }
    return toolCopy('搜索网页', sentence(text('搜索网页 '), param(readToolQueryLabel(input))))
  },
  browser_use: (input) => {
    const action = input ? readStringValue(input, 'action') || '' : ''
    const urlLabel = readWebUrlLabel(input)
    const instructionLabel = readInstructionLabel(input)
    const actionIdLabel = input ? readStringValue(input, 'actionId') || '' : ''
    const tabIdLabel = input ? readStringValue(input, 'tabId') || '' : ''
    if (action === 'navigate') {
      return toolCopy('打开网页', sentence(text('打开网页 '), param(urlLabel)))
    }
    if (action === 'list_tabs') {
      return toolCopy('列出标签', sentence(text('列出浏览器标签')))
    }
    if (action === 'observe') {
      return toolCopy('查看页面', sentence(text('查看页面并'), param(instructionLabel)))
    }
    if (action === 'extract') {
      return toolCopy('提取内容', sentence(text('从页面中'), param(instructionLabel)))
    }
    if (action === 'act') {
      return toolCopy(
        '操作页面',
        sentence(text('在页面上执行 '), param(actionIdLabel || instructionLabel || '动作'))
      )
    }
    if (action === 'act_instruction') {
      return toolCopy(
        '操作页面',
        sentence(text('在页面上执行 '), param(instructionLabel || '动作'))
      )
    }
    if (action === 'screenshot') {
      return toolCopy(
        '截取页面',
        sentence(text('截取页面 '), param(tabIdLabel || '当前标签'))
      )
    }
    if (action === 'scroll') {
      return toolCopy(
        '滚动页面',
        sentence(text('滚动页面 '), param(tabIdLabel || '当前标签'))
      )
    }
    return toolCopy('操作浏览器', sentence(text('操作浏览器 '), param(instructionLabel)))
  },
  read_image: () => toolCopy('读取图片', sentence(text('读取图片'))),
  image_generate: (input) =>
    toolCopy('生成图片', sentence(text('生成图片 '), param(readToolFileLabel(input)))),
  learn_skill: (input, status) => {
    const skillName = readLearnSkillNames(input)
    if (status === 'running') {
      return toolCopy(`正在学习 ${skillName}`, sentence(text('正在学习 '), text(skillName)))
    }
    if (status === 'completed') {
      return toolCopy(`已学会 ${skillName}`, sentence(text('已学会 '), text(skillName)))
    }
    if (status === 'partial_failed') {
      return toolCopy(
        `学习 ${skillName} 有部分失败`,
        sentence(text('学习 '), text(skillName), text(' 有部分失败'))
      )
    }
    return toolCopy(
      `学习 ${skillName} 失败了`,
      sentence(text('学习 '), text(skillName), text(' 失败了'))
    )
  },
  update_plan: () => toolCopy('更新任务计划', sentence(text('更新任务计划')))
} satisfies Record<RuntimeToolName, ToolItemRenderer>

const getToolItemCopy = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): ToolItemCopy =>
  toolName === 'unnamed'
    ? toolCopy('处理任务中的一步', sentence(text('处理任务中的一步')))
    : TOOL_ITEM_RENDERERS[toolName](input, status)

const getToolItemText = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] => getToolItemCopy(toolName, status, input).detail

const getToolItemHeaderShort = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): string => getToolItemCopy(toolName, status, input).headerShort

const getDisplayGroupText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'thinking') {
    if (status === 'running') return sentence(text('让俺想想'))
    return []
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
  if (display.kind === 'tool') {
    return getToolItemText(normalizeToolName(display.toolName), status, display.input)
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
  resolveAssistantExecutionStatus,
  resolveItemIconKind
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
    sourceEventType: input.sourceEventType
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
  const headerShortText = toolName
    ? getToolItemHeaderShort(
        toolName,
        input.status,
        input.display.kind === 'tool' ? input.display.input : undefined
      )
    : input.existing?.headerShortText
  return {
    id: input.itemId,
    status: input.status,
    runningText: input.existing?.runningText || getDisplayItemText(input.display, 'running'),
    completedText: input.existing?.completedText || getDisplayItemText(input.display, 'completed'),
    failedText: input.existing?.failedText || getDisplayItemText(input.display, 'failed'),
    partialFailedText:
      input.existing?.partialFailedText || getDisplayItemText(input.display, 'partial_failed'),
    headerShortText,
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
    completedText: [],
    failedText: [],
    partialFailedText: [],
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
    .filter(
      (group) =>
        group.kind !== 'finalizing' && group.kind !== 'learning' && group.kind !== 'thinking'
    )
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

const withoutThinkingGroups = (groups: AssistantProcessGroup[]): AssistantProcessGroup[] =>
  groups.filter((group) => group.kind !== 'thinking')

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
  // Thinking UI is driven by thinking started/completed process events.
  // A new thinking started replaces any previous thinking row (incl. optimistic placeholder).
  // Retry is a competing wait state and must replace thinking immediately.
  const baseGroups =
    input.kind === 'thinking' || input.kind === 'retry' ? withoutThinkingGroups(current) : current
  const existing = baseGroups.find((group) => group.id === input.groupId)
  const next = createDisplayProcessGroup({
    groupId: input.groupId,
    kind: input.kind,
    display: input.display,
    status: input.status,
    createdAt: existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType
  })
  return upsertProcessGroup(baseGroups, {
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
      const toolName =
        input.display?.kind === 'tool'
          ? normalizeToolName(input.display.toolName)
          : item.toolName
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
        headerShortText:
          input.display && toolName
            ? getToolItemHeaderShort(
                toolName,
                input.status,
                input.display.kind === 'tool' ? input.display.input : item.input
              )
            : item.headerShortText,
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
    return withoutThinkingGroups(current)
  }

  if (event.type === 'assistant_process_group_started') {
    if (
      event.kind === 'learning' ||
      event.kind === 'finalizing' ||
      event.kind === 'thinking' ||
      event.display.kind === 'learning' ||
      event.display.kind === 'finalizing' ||
      event.display.kind === 'thinking'
    ) {
      return withoutThinkingGroups(current)
    }
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
    if (event.groupId.endsWith(':thinking') || event.display?.kind === 'thinking') {
      return withoutThinkingGroups(current)
    }
    if (event.groupId.endsWith(':finalizing')) {
      return current.filter((group) => group.id !== event.groupId)
    }
    if (event.display?.kind === 'learning' || event.display?.kind === 'finalizing') return current
    return completeProcessGroupById(current, event.groupId, 'completed', event.display)
  }

  if (event.type === 'assistant_process_group_failed') {
    if (event.groupId.endsWith(':thinking') || event.display?.kind === 'thinking') {
      return withoutThinkingGroups(current)
    }
    if (event.display?.kind === 'learning' || event.display?.kind === 'finalizing') return current
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

export {
  isAssistantActivityToolGroup,
  shouldShowAssistantThinkingIndicator,
  shouldActivityHeaderShimmer
} from '../../../../shared/assistantThinkingWait'

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

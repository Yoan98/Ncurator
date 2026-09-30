import type { IpcJsonObject } from './types'
import type { RuntimeToolName } from './runtimeCapabilities'

export type AssistantExecutionStatus = 'running' | 'completed' | 'failed' | 'partial_failed'

export type AssistantExecutionIconKind =
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

export type AssistantExecutionSkillKey =
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

export type AssistantExecutionTextSegment = {
  text: string
  emphasis?: boolean
  iconKind?: AssistantExecutionIconKind
  /** Dynamic tool argument (path/command/query/url). Omitted from Activity header short text. */
  param?: boolean
}

export type AssistantExecutionGroup = {
  id: string
  skillKey: AssistantExecutionSkillKey
  status: AssistantExecutionStatus
  items: readonly {
    toolName?: RuntimeToolName | 'unnamed'
    targetLabel?: string
    input?: IpcJsonObject
    status?: AssistantExecutionStatus
    runningText?: readonly AssistantExecutionTextSegment[]
    completedText?: readonly AssistantExecutionTextSegment[]
    failedText?: readonly AssistantExecutionTextSegment[]
    partialFailedText?: readonly AssistantExecutionTextSegment[]
    /** Standalone header verb phrase; preferred over stripping param segments. */
    headerShortText?: string
  }[]
}

const text = (value: string): AssistantExecutionTextSegment => ({ text: value })
const sentence = (...segments: AssistantExecutionTextSegment[]): AssistantExecutionTextSegment[] =>
  segments

const toHeaderShortSegments = (
  segments: readonly AssistantExecutionTextSegment[]
): AssistantExecutionTextSegment[] => {
  const shortSegments = segments.filter((segment) => !segment.param)
  return shortSegments.length > 0 ? [...shortSegments] : [...segments]
}

const TOOL_UI_KINDS = {
  terminal_run: 'terminal',
  terminal_read: 'terminal',
  text_file_read: 'file-read',
  text_file_search: 'file-read',
  text_file_edit: 'file-edit',
  kb_search: 'kb',
  kb_list_documents: 'kb',
  docx_read_outline: 'docx-read',
  docx_search: 'docx-read',
  docx_read_nodes: 'docx-read',
  docx_content_edit: 'docx-edit',
  docx_format: 'docx-edit',
  docx_table_edit: 'docx-edit',
  docx_comments_revisions: 'docx-edit',
  pdf_outline: 'pdf-read',
  pdf_search: 'pdf-read',
  pdf_read_pages: 'pdf-read',
  ppt_read_outline: 'ppt-read',
  ppt_read_slides: 'ppt-read',
  ppt_search: 'ppt-search',
  ppt_edit: 'ppt-edit',
  excel_read: 'excel-read',
  excel_edit: 'excel-edit',
  web_search: 'web-search',
  browser_use: 'browser',
  image_generate: 'image-generation',
  learn_skill: 'learning',
  update_plan: 'generic',
  read_image: 'image-read',
  delegate_to_subagent: 'generic',
  ask_user_question: 'generic',
  scheduled_task_list: 'generic',
  scheduled_task_action: 'generic'
} as const satisfies Record<RuntimeToolName, AssistantExecutionSkillKey>

export const getAssistantToolUiKind = (
  toolName?: RuntimeToolName | 'unnamed'
): AssistantExecutionSkillKey =>
  toolName && toolName !== 'unnamed' ? TOOL_UI_KINDS[toolName] : 'generic'

export const getAssistantToolIconKind = (
  skillKey: AssistantExecutionSkillKey
): AssistantExecutionIconKind => {
  if (skillKey === 'docx-edit' || skillKey === 'file-edit') return 'edit'
  if (
    skillKey === 'docx-read' ||
    skillKey === 'file-read' ||
    skillKey === 'pdf-read' ||
    skillKey === 'ppt-read' ||
    skillKey === 'excel-read'
  ) {
    return 'document'
  }
  if (skillKey === 'ppt-search' || skillKey === 'web-search') return 'search'
  if (skillKey === 'ppt-edit' || skillKey === 'excel-edit') return 'edit'
  if (skillKey === 'kb') return 'knowledge'
  if (skillKey === 'browser') return 'browser'
  if (skillKey === 'image-generation' || skillKey === 'image-read') return 'image'
  if (skillKey === 'learning') return 'learning'
  if (skillKey === 'terminal') return 'terminal'
  return 'default'
}

export const getAssistantMixedStatus = (
  statuses: readonly AssistantExecutionStatus[],
  fallback: AssistantExecutionStatus = 'completed'
): AssistantExecutionStatus => {
  if (statuses.length === 0) return fallback
  if (statuses.some((status) => status === 'running')) return 'running'
  const hasCompleted = statuses.some((status) => status === 'completed')
  const hasFailed = statuses.some((status) => status === 'failed')
  const hasPartialFailed = statuses.some((status) => status === 'partial_failed')
  if (hasPartialFailed || (hasCompleted && hasFailed)) return 'partial_failed'
  if (hasFailed) return 'failed'
  return 'completed'
}

type StatusText = Record<AssistantExecutionStatus, string>

const statusText = (
  status: AssistantExecutionStatus,
  values: StatusText
): AssistantExecutionTextSegment[] => sentence(text(values[status]))

/** Fallback summaries for non-tool process groups (e.g. search mode kb placeholder). */
export const getAssistantToolSummaryText = (
  skillKey: AssistantExecutionSkillKey,
  status: AssistantExecutionStatus,
  count = 1
): AssistantExecutionTextSegment[] => {
  const normalizedCount = String(Math.max(1, count))
  if (skillKey === 'docx-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个 Word 文档`,
      completed: `已读取 ${normalizedCount} 个 Word 文档`,
      partial_failed: `部分读取 ${normalizedCount} 个 Word 文档失败`,
      failed: `读取 ${normalizedCount} 个 Word 文档失败`
    })
  }
  if (skillKey === 'docx-edit') {
    return statusText(status, {
      running: `正在编辑 ${normalizedCount} 个 Word 文档`,
      completed: `已编辑 ${normalizedCount} 个 Word 文档`,
      partial_failed: `部分编辑 ${normalizedCount} 个 Word 文档失败`,
      failed: `编辑 ${normalizedCount} 个 Word 文档失败`
    })
  }
  if (skillKey === 'file-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个文件`,
      completed: `已读取 ${normalizedCount} 个文件`,
      partial_failed: `部分读取 ${normalizedCount} 个文件失败`,
      failed: `读取 ${normalizedCount} 个文件失败`
    })
  }
  if (skillKey === 'file-edit') {
    return statusText(status, {
      running: `正在编辑 ${normalizedCount} 个文件`,
      completed: `已编辑 ${normalizedCount} 个文件`,
      partial_failed: `部分编辑 ${normalizedCount} 个文件失败`,
      failed: `编辑 ${normalizedCount} 个文件失败`
    })
  }
  if (skillKey === 'pdf-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个 PDF 文件`,
      completed: `已读取 ${normalizedCount} 个 PDF 文件`,
      partial_failed: `部分读取 ${normalizedCount} 个 PDF 文件失败`,
      failed: `读取 ${normalizedCount} 个 PDF 文件失败`
    })
  }
  if (skillKey === 'ppt-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个 PPT 文件`,
      completed: `已读取 ${normalizedCount} 个 PPT 文件`,
      partial_failed: `部分读取 ${normalizedCount} 个 PPT 文件失败`,
      failed: `读取 ${normalizedCount} 个 PPT 文件失败`
    })
  }
  if (skillKey === 'ppt-search') {
    return statusText(status, {
      running: '正在搜索 PPT',
      completed: '已搜索 PPT',
      partial_failed: '部分 PPT 搜索失败',
      failed: '搜索 PPT 失败'
    })
  }
  if (skillKey === 'ppt-edit') {
    return statusText(status, {
      running: `正在编辑 ${normalizedCount} 个 PPT 文件`,
      completed: `已编辑 ${normalizedCount} 个 PPT 文件`,
      partial_failed: `部分编辑 ${normalizedCount} 个 PPT 文件失败`,
      failed: `编辑 ${normalizedCount} 个 PPT 文件失败`
    })
  }
  if (skillKey === 'excel-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个 Excel 文件`,
      completed: `已读取 ${normalizedCount} 个 Excel 文件`,
      partial_failed: `部分读取 ${normalizedCount} 个 Excel 文件失败`,
      failed: `读取 ${normalizedCount} 个 Excel 文件失败`
    })
  }
  if (skillKey === 'excel-edit') {
    return statusText(status, {
      running: `正在编辑 ${normalizedCount} 个 Excel 文件`,
      completed: `已编辑 ${normalizedCount} 个 Excel 文件`,
      partial_failed: `部分编辑 ${normalizedCount} 个 Excel 文件失败`,
      failed: `编辑 ${normalizedCount} 个 Excel 文件失败`
    })
  }
  if (skillKey === 'kb') {
    return statusText(status, {
      running: '正在检索知识库',
      completed: '已检索知识库',
      partial_failed: '部分知识库检索失败',
      failed: '检索知识库失败'
    })
  }
  if (skillKey === 'terminal') {
    return statusText(status, {
      running: '正在执行终端指令',
      completed: '已执行终端指令',
      partial_failed: '部分终端指令执行失败',
      failed: '执行终端指令失败'
    })
  }
  if (skillKey === 'web-search') {
    return statusText(status, {
      running: '正在搜索网页',
      completed: '已搜索网页',
      partial_failed: '部分网页搜索失败',
      failed: '搜索网页失败'
    })
  }
  if (skillKey === 'browser') {
    return statusText(status, {
      running: '正在操作浏览器',
      completed: `已操作浏览器 ${normalizedCount} 次`,
      partial_failed: '部分浏览器操作失败',
      failed: '浏览器操作失败'
    })
  }
  if (skillKey === 'image-generation') {
    return statusText(status, {
      running: '正在生成图片',
      completed: '已生成图片',
      partial_failed: '部分图片生成失败',
      failed: '图片生成失败'
    })
  }
  if (skillKey === 'learning') {
    return statusText(status, {
      running: '正在学习技能',
      completed: '已学会技能',
      partial_failed: '部分技能学习失败',
      failed: '学习技能失败'
    })
  }
  return statusText(status, {
    running: '正在处理任务',
    completed: '已处理任务',
    partial_failed: '部分任务处理失败',
    failed: '处理任务失败'
  })
}

const getExecutionStatus = (groups: readonly AssistantExecutionGroup[]): AssistantExecutionStatus =>
  getAssistantMixedStatus(groups.map((group) => group.status))

const getItemSegments = (
  item: AssistantExecutionGroup['items'][number],
  fallbackStatus: AssistantExecutionStatus
): AssistantExecutionTextSegment[] => {
  const status = item.status || fallbackStatus
  if (status === 'completed' && item.completedText) return [...item.completedText]
  if (status === 'failed' && item.failedText) return [...item.failedText]
  if (status === 'partial_failed' && item.partialFailedText) return [...item.partialFailedText]
  if (status === 'running' && item.runningText) return [...item.runningText]
  if (item.completedText) return [...item.completedText]
  if (item.runningText) return [...item.runningText]
  const kind = item.toolName ? getAssistantToolUiKind(item.toolName) : 'generic'
  return getAssistantToolSummaryText(kind, status)
}

const getItemHeaderShortSegments = (
  item: AssistantExecutionGroup['items'][number],
  fallbackStatus: AssistantExecutionStatus
): AssistantExecutionTextSegment[] => {
  const short = item.headerShortText?.trim()
  if (short) return sentence(text(short))
  return trimHeaderSegments(toHeaderShortSegments(getItemSegments(item, fallbackStatus)))
}

const buildCountOnlySummary = (
  status: AssistantExecutionStatus,
  totalCount: number
): AssistantExecutionTextSegment[] => {
  if (status === 'partial_failed') {
    return sentence(text(`${totalCount} 项操作中有部分失败`))
  }
  if (status === 'failed') {
    return sentence(text(`${totalCount} 项操作执行失败`))
  }
  // Form 2: always completed tense (no running/completed flicker).
  return sentence(text(`已完成 ${totalCount} 项`))
}

const trimHeaderSegments = (
  segments: readonly AssistantExecutionTextSegment[]
): AssistantExecutionTextSegment[] => {
  if (segments.length === 0) return []
  const next = segments.map((segment) => ({ ...segment }))
  const last = next[next.length - 1]
  if (last) last.text = last.text.replace(/\s+$/u, '')
  const first = next[0]
  if (first) first.text = first.text.replace(/^\s+/u, '')
  return next.filter((segment) => segment.text.length > 0)
}

/**
 * Activity header from tool copy:
 * - prefer explicit headerShortText; else drop param segments (legacy)
 * - merge same tool UI kind / browser action; single = short sentence; count>1 append「N 次」
 * - ≤3 merged kinds join with `,`（无空格）；>3 kinds →「已完成 n 项」(n = total tools)
 */
const readInputProperty = (input: IpcJsonObject | undefined, key: string): string => {
  if (!input || typeof input !== 'object') return ''
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export const buildAssistantExecutionSummaryText = (
  groups: readonly AssistantExecutionGroup[]
): AssistantExecutionTextSegment[] => {
  const status = getExecutionStatus(groups)
  const list = groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, status: item.status || group.status }))
  )
  if (list.length === 0) {
    return statusText(status, {
      running: '正在处理任务',
      completed: '已处理任务',
      partial_failed: '部分任务处理失败',
      failed: '处理任务失败'
    })
  }

  const kindOrder: string[] = []
  const itemsByKind = new Map<string, typeof list>()
  for (const item of list) {
    let kind: string = item.toolName ? getAssistantToolUiKind(item.toolName) : 'generic'
    if (item.toolName === 'browser_use') {
      const action = readInputProperty(item.input, 'action')
      const headerShort = item.headerShortText || ''
      kind = `browser-${action || headerShort || 'action'}`
    } else if (item.toolName === 'web_search') {
      const type = readInputProperty(item.input, 'type')
      const headerShort = item.headerShortText || ''
      if (type === 'fetch' || headerShort === '抓取网页') {
        kind = 'web-fetch'
      }
    }
    if (!itemsByKind.has(kind)) {
      kindOrder.push(kind)
      itemsByKind.set(kind, [])
    }
    itemsByKind.get(kind)?.push(item)
  }

  if (kindOrder.length > 3) {
    return buildCountOnlySummary(status, list.length)
  }

  return kindOrder.flatMap((kind, index) => {
    const kindItems = itemsByKind.get(kind) || []
    const kindStatus = getAssistantMixedStatus(
      kindItems.map((item) => item.status || status),
      status
    )
    const representative = kindItems[0]
    const shortSegments = trimHeaderSegments(getItemHeaderShortSegments(representative, kindStatus))
    const prefix = index === 0 ? '' : '、'
    const countSuffix =
      kindItems.length > 1
        ? [text(` ${kindItems.length} 次`)]
        : ([] as AssistantExecutionTextSegment[])
    return sentence(text(prefix), ...shortSegments, ...countSuffix)
  })
}

export const resolveItemIconKind = (
  item: {
    toolName?: RuntimeToolName | 'unnamed'
    input?: IpcJsonObject
    headerShortText?: string
  },
  fallbackSkillKey?: AssistantExecutionSkillKey
): AssistantExecutionIconKind => {
  if (item.toolName === 'ask_user_question') return 'question'
  if (item.toolName === 'browser_use') {
    const action = readInputProperty(item.input, 'action')
    const headerShort = item.headerShortText || ''
    if (action === 'navigate' || headerShort === '打开网页') return 'web'
    if (action === 'observe' || headerShort === '查看页面') return 'eye'
    if (action === 'extract' || headerShort === '提取内容') return 'extract'
    if (action === 'act' || action === 'act_instruction' || headerShort === '操作页面')
      return 'browser'
    if (action === 'screenshot' || headerShort === '截取页面') return 'camera'
    if (action === 'scroll' || headerShort === '滚动页面') return 'scroll'
    if (action === 'list_tabs' || headerShort === '列出标签') return 'window'
    return 'browser'
  }
  if (item.toolName === 'web_search') {
    const type = readInputProperty(item.input, 'type')
    const headerShort = item.headerShortText || ''
    if (type === 'fetch' || headerShort === '抓取网页') return 'fetch'
    return 'search'
  }
  if (item.toolName && item.toolName !== 'unnamed') {
    return getAssistantToolIconKind(getAssistantToolUiKind(item.toolName))
  }
  return getAssistantToolIconKind(fallbackSkillKey || 'generic')
}

export const resolveAssistantExecutionIcon = (
  groups: readonly AssistantExecutionGroup[]
): AssistantExecutionIconKind => {
  const iconKinds = new Set<AssistantExecutionIconKind>()
  for (const group of groups) {
    if (group.items.length > 0) {
      for (const item of group.items) {
        iconKinds.add(resolveItemIconKind(item, group.skillKey))
      }
    } else {
      iconKinds.add(getAssistantToolIconKind(group.skillKey))
    }
  }
  if (iconKinds.size === 1) return [...iconKinds][0] || 'generic'
  if (iconKinds.size === 2 && iconKinds.has('camera') && iconKinds.has('image')) {
    return 'image'
  }
  return 'workflow'
}

export const resolveAssistantExecutionStatus = getExecutionStatus

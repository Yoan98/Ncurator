import type { IpcJsonObject, IpcJsonValue } from './types'
import type { RuntimeToolName } from './runtimeCapabilities'

export type AssistantExecutionStatus = 'running' | 'completed' | 'failed' | 'partial_failed'

export type AssistantExecutionIconKind =
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
  | 'web-crawl'
  | 'browser'
  | 'image-recognition'
  | 'image-generation'
  | 'wait'
  | 'user-takeover'
  | 'generic'

export type AssistantExecutionTextSegment = {
  text: string
  emphasis?: boolean
  iconKind?: AssistantExecutionIconKind
}

export type AssistantExecutionGroup = {
  id: string
  skillKey: AssistantExecutionSkillKey
  status: AssistantExecutionStatus
  items: readonly {
    toolName?: RuntimeToolName | 'unnamed'
    targetLabel?: string
    input?: IpcJsonObject
  }[]
}

const text = (value: string): AssistantExecutionTextSegment => ({ text: value })
const sentence = (...segments: AssistantExecutionTextSegment[]): AssistantExecutionTextSegment[] =>
  segments

const TOOL_UI_KINDS = {
  terminal_run: 'terminal',
  terminal_read: 'terminal',
  terminal_stop: 'terminal',
  text_file_read: 'file-read',
  text_file_edit: 'file-edit',
  kb_search: 'kb',
  kb_list_documents: 'kb',
  docx_read_outline: 'docx-read',
  docx_search: 'docx-read',
  docx_read_blocks: 'docx-read',
  docx_read_visuals: 'docx-read',
  docx_edit: 'docx-edit',
  pdf_inspect: 'pdf-read',
  pdf_search: 'pdf-read',
  pdf_read_pages: 'pdf-read',
  pdf_read_visuals: 'pdf-read',
  ppt_read_outline: 'ppt-read',
  ppt_read_slides: 'ppt-read',
  ppt_search: 'ppt-search',
  ppt_read_visuals: 'ppt-read',
  ppt_edit: 'ppt-edit',
  excel_read_outline: 'excel-read',
  excel_search: 'excel-read',
  excel_read_cells: 'excel-read',
  excel_edit: 'excel-edit',
  web_search: 'web-search',
  web_crawl: 'web-crawl',
  browser_use: 'browser',
  wait_time: 'wait',
  wait_for_user_takeover: 'user-takeover',
  image_analyze: 'image-recognition',
  image_generate: 'image-generation',
  learn_skill: 'generic',
  update_plan: 'generic',
  finish: 'generic'
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
  if (skillKey === 'web-crawl') return 'web'
  if (skillKey === 'browser' || skillKey === 'user-takeover') return 'browser'
  if (skillKey === 'image-recognition' || skillKey === 'image-generation') return 'image'
  if (skillKey === 'wait') return 'wait'
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

export const getAssistantToolSummaryText = (
  skillKey: AssistantExecutionSkillKey,
  status: AssistantExecutionStatus,
  count = 1
): AssistantExecutionTextSegment[] => {
  const normalizedCount = String(Math.max(1, count))
  if (skillKey === 'docx-read') {
    return statusText(status, {
      running: `正在读取 ${normalizedCount} 个 docx 文件`,
      completed: `已读取 ${normalizedCount} 个 docx 文件`,
      partial_failed: `部分读取 ${normalizedCount} 个 docx 文件失败`,
      failed: `读取 ${normalizedCount} 个 docx 文件失败`
    })
  }
  if (skillKey === 'docx-edit') {
    return statusText(status, {
      running: `正在编辑 ${normalizedCount} 个 docx 文件`,
      completed: `已编辑 ${normalizedCount} 个 docx 文件`,
      partial_failed: `部分编辑 ${normalizedCount} 个 docx 文件失败`,
      failed: `编辑 ${normalizedCount} 个 docx 文件失败`
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
  if (skillKey === 'web-crawl') {
    return statusText(status, {
      running: '正在读取网页',
      completed: '已读取网页',
      partial_failed: '部分网页读取失败',
      failed: '读取网页失败'
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
  if (skillKey === 'image-recognition') {
    return statusText(status, {
      running: '正在识别图片',
      completed: '已识别图片',
      partial_failed: '部分图片识别失败',
      failed: '图片识别失败'
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
  if (skillKey === 'wait') {
    return statusText(status, {
      running: '正在等待',
      completed: '已等待',
      partial_failed: '部分等待失败',
      failed: '等待失败'
    })
  }
  if (skillKey === 'user-takeover') {
    return statusText(status, {
      running: '正在等待用户接管浏览器',
      completed: '用户已完成浏览器操作',
      partial_failed: '等待用户接管浏览器时部分失败',
      failed: '等待用户接管浏览器失败'
    })
  }
  return statusText(status, {
    running: '正在处理任务',
    completed: '已处理任务',
    partial_failed: '部分任务处理失败',
    failed: '处理任务失败'
  })
}

const readWaitDurationLabel = (input?: IpcJsonObject): string => {
  if (!input) return '一段时间'
  const seconds = (input as Record<string, IpcJsonValue>).seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds)) return `${String(seconds)} 秒`
  if (typeof seconds === 'string' && seconds.trim()) return `${seconds.trim()} 秒`
  return '一段时间'
}

type ExecutionActionSummary = {
  kind: AssistantExecutionSkillKey
  fileLabels: Set<string>
  count: number
  statuses: AssistantExecutionStatus[]
  waitLabels: Set<string>
}

const getExecutionStatus = (groups: readonly AssistantExecutionGroup[]): AssistantExecutionStatus =>
  getAssistantMixedStatus(groups.map((group) => group.status))

const getSummaryActionLabel = (kind: AssistantExecutionSkillKey): string => {
  if (
    kind === 'docx-read' ||
    kind === 'file-read' ||
    kind === 'pdf-read' ||
    kind === 'ppt-read' ||
    kind === 'excel-read' ||
    kind === 'web-crawl'
  ) {
    return '读取'
  }
  if (
    kind === 'docx-edit' ||
    kind === 'file-edit' ||
    kind === 'ppt-edit' ||
    kind === 'excel-edit'
  ) {
    return '编辑'
  }
  if (kind === 'ppt-search' || kind === 'web-search') return '搜索'
  if (kind === 'kb') return '检索'
  if (kind === 'terminal') return '终端'
  if (kind === 'browser' || kind === 'user-takeover') return '浏览器'
  if (kind === 'image-recognition' || kind === 'image-generation') return '图片'
  if (kind === 'wait') return '等待'
  return '处理'
}

const getSummaryActionLabelText = (summaries: readonly ExecutionActionSummary[]): string => {
  const labels = Array.from(
    new Set(summaries.map((summary) => getSummaryActionLabel(summary.kind)))
  )
  if (labels.length === 0) return ''
  return `${labels.slice(0, 3).join('、')}${summaries.length > 3 ? '等' : ''}`
}

export const buildAssistantExecutionSummaryText = (
  groups: readonly AssistantExecutionGroup[]
): AssistantExecutionTextSegment[] => {
  const summaries = new Map<AssistantExecutionSkillKey, ExecutionActionSummary>()
  for (const group of groups) {
    const entries =
      group.items.length > 0
        ? group.items.map((item) => ({
            toolName: item.toolName,
            targetLabel: item.targetLabel,
            input: item.input
          }))
        : [{ toolName: undefined, targetLabel: undefined, input: undefined }]
    for (const entry of entries) {
      const kind = entry.toolName ? getAssistantToolUiKind(entry.toolName) : group.skillKey
      const current =
        summaries.get(kind) ||
        ({
          kind,
          fileLabels: new Set<string>(),
          count: 0,
          statuses: [],
          waitLabels: new Set<string>()
        } satisfies ExecutionActionSummary)
      current.count += 1
      current.statuses.push(group.status)
      if (
        kind === 'docx-read' ||
        kind === 'docx-edit' ||
        kind === 'ppt-read' ||
        kind === 'ppt-edit' ||
        kind === 'excel-read' ||
        kind === 'excel-edit'
      ) {
        current.fileLabels.add(entry.targetLabel || group.id)
      }
      if (kind === 'wait') current.waitLabels.add(readWaitDurationLabel(entry.input))
      summaries.set(kind, current)
    }
  }

  const status = getExecutionStatus(groups)
  const ordered = [...summaries.values()]
  if (ordered.length === 0) return sentence(text('正在处理任务'))

  const totalCount = ordered.reduce((sum, summary) => sum + summary.count, 0)
  if (ordered.length > 3) {
    const actionText = getSummaryActionLabelText(ordered)
    const suffix = actionText ? `：${actionText}` : ''
    if (status === 'running') return sentence(text(`正在执行 ${totalCount} 项操作${suffix}`))
    if (status === 'completed') return sentence(text(`已完成 ${totalCount} 项操作${suffix}`))
    if (status === 'partial_failed') {
      return sentence(text(`${totalCount} 项操作中有部分失败${suffix}`))
    }
    return sentence(text(`${totalCount} 项操作执行失败${suffix}`))
  }

  return ordered.flatMap((summary, index) => {
    const count = summary.fileLabels.size || summary.count || 1
    const summaryStatus = getAssistantMixedStatus(summary.statuses, status)
    const prefix =
      index === 0
        ? ''
        : summaryStatus === 'failed' || summaryStatus === 'partial_failed'
          ? '但'
          : '并'
    if (summary.kind === 'wait' && summary.waitLabels.size === 1) {
      const waitLabel = [...summary.waitLabels][0]
      if (summaryStatus === 'running') return sentence(text(prefix), text(`正在等待 ${waitLabel}`))
      if (summaryStatus === 'completed') return sentence(text(prefix), text(`等待 ${waitLabel}`))
    }
    return sentence(
      text(prefix),
      ...getAssistantToolSummaryText(summary.kind, summaryStatus, count)
    )
  })
}

export const resolveAssistantExecutionIcon = (
  groups: readonly AssistantExecutionGroup[]
): AssistantExecutionIconKind => {
  const kinds = new Set(
    groups.flatMap((group) =>
      group.items.length > 0
        ? group.items.map((item) =>
            item.toolName ? getAssistantToolUiKind(item.toolName) : group.skillKey
          )
        : [group.skillKey]
    )
  )
  if (kinds.size !== 1) return 'workflow'
  return getAssistantToolIconKind([...kinds][0] || 'generic')
}

export const resolveAssistantExecutionStatus = getExecutionStatus

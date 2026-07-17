import type {
  AiRunEvent,
  AssistantProcessDisplay,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  RuntimeSkillId,
  SearchResult,
  WorkbenchSelectedModel,
  WorkspaceSource
} from '../../../../shared/types'
import {
  WORKBENCH_PREFERENCE_AI_PREFERENCE_STORAGE_KEY,
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
  WorkbenchAiPreference,
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

const isWorkbenchAiPreference = (value: string | null): value is WorkbenchAiPreference =>
  value === 'default' || value === 'local_sources_relaxed' || value === 'local_sources_strict'

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
  toolName === 'terminal_read' ||
  toolName === 'terminal_stop' ||
  toolName === 'file_read' ||
  toolName === 'file_write' ||
  toolName === 'kb_search' ||
  toolName === 'kb_list_documents' ||
  toolName === 'docx_outline' ||
  toolName === 'docx_search' ||
  toolName === 'docx_read_blocks' ||
  toolName === 'docx_edit' ||
  toolName === 'pdf_inspect' ||
  toolName === 'pdf_search' ||
  toolName === 'pdf_read_pages' ||
  toolName === 'pdf_render_pages' ||
  toolName === 'ppt_outline' ||
  toolName === 'ppt_read_slides' ||
  toolName === 'ppt_search' ||
  toolName === 'ppt_render' ||
  toolName === 'ppt_edit' ||
  toolName === 'web_search' ||
  toolName === 'web_crawl' ||
  toolName === 'browser_use' ||
  toolName === 'llm_recognize' ||
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
  if (skillId === 'text-file') return '文件编辑器'
  if (skillId === 'kb-retrieval') return '资料查阅器'
  if (skillId === 'docx-read') return 'docx 阅读器'
  if (skillId === 'docx-write') return 'docx 写作器'
  if (skillId === 'pdf-read') return 'PDF 阅读器'
  if (skillId === 'ppt-read') return 'PPT 阅读器'
  if (skillId === 'ppt-write') return 'PPT 编辑器'
  if (skillId === 'image-recognition') return '图像识别'
  return '新能力'
}

const getToolUiKind = (toolName?: AssistantToolName): AssistantProcessSkillKey => {
  if (
    toolName === 'docx_outline' ||
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_search'
  ) {
    return 'docx-read'
  }
  if (toolName === 'docx_edit') return 'docx-edit'
  if (toolName === 'file_read') return 'file-read'
  if (toolName === 'file_write') return 'file-write'
  if (
    toolName === 'pdf_inspect' ||
    toolName === 'pdf_search' ||
    toolName === 'pdf_read_pages' ||
    toolName === 'pdf_render_pages'
  ) {
    return 'pdf-read'
  }
  if (
    toolName === 'ppt_outline' ||
    toolName === 'ppt_read_slides' ||
    toolName === 'ppt_search' ||
    toolName === 'ppt_render' ||
    toolName === 'ppt_edit'
  ) {
    return 'ppt'
  }
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return 'kb'
  if (toolName === 'terminal_run' || toolName === 'terminal_read' || toolName === 'terminal_stop') {
    return 'terminal'
  }
  if (toolName === 'web_search') return 'web-search'
  if (toolName === 'web_crawl') return 'web-crawl'
  if (toolName === 'browser_use') return 'browser'
  if (toolName === 'llm_recognize') return 'image-recognition'
  if (toolName === 'wait_time') return 'wait'
  return 'generic'
}

const getDisplaySkillKey = (display: AssistantProcessDisplay): AssistantProcessSkillKey => {
  if (display.kind === 'tool') return getToolUiKind(normalizeToolName(display.toolName))
  return 'generic'
}

const getToolIconKind = (skillKey: AssistantProcessSkillKey): AssistantProcessIconKind => {
  if (skillKey === 'docx-edit') return 'edit'
  if (skillKey === 'docx-read' || skillKey === 'pdf-read' || skillKey === 'ppt') return 'document'
  if (skillKey === 'file-read') return 'document'
  if (skillKey === 'file-write') return 'edit'
  if (skillKey === 'kb') return 'knowledge'
  if (skillKey === 'web-search') return 'search'
  if (skillKey === 'web-crawl') return 'web'
  if (skillKey === 'browser') return 'browser'
  if (skillKey === 'image-recognition') return 'image'
  if (skillKey === 'wait') return 'wait'
  if (skillKey === 'terminal') return 'terminal'
  return 'default'
}

const getMixedStatus = (
  statuses: AssistantProcessStatus[],
  fallback: AssistantProcessStatus = 'completed'
): AssistantProcessStatus => {
  if (statuses.length === 0) return fallback
  if (statuses.some((status) => status === 'running')) return 'running'
  const hasCompleted = statuses.some((status) => status === 'completed')
  const hasFailed = statuses.some((status) => status === 'failed')
  const hasPartialFailed = statuses.some((status) => status === 'partial_failed')
  if (hasPartialFailed) return 'partial_failed'
  if (hasCompleted && hasFailed) return 'partial_failed'
  if (hasFailed) return 'failed'
  return 'completed'
}

const getDisplayIconKind = (display: AssistantProcessDisplay): AssistantProcessIconKind => {
  if (display.kind === 'thinking') return 'default'
  if (display.kind === 'learning') return 'learning'
  if (display.kind === 'retry') return 'retry'
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
    if (status === 'partial_failed') {
      return sentence(text(`部分读取 ${normalizedCount} 个 docx 文件失败`))
    }
    return sentence(text(`读取 ${normalizedCount} 个 docx 文件失败`))
  }
  if (skillKey === 'docx-edit') {
    if (status === 'running') return sentence(text(`正在编辑 ${normalizedCount} 个 docx 文件`))
    if (status === 'completed') return sentence(text(`已编辑 ${normalizedCount} 个 docx 文件`))
    if (status === 'partial_failed') {
      return sentence(text(`部分编辑 ${normalizedCount} 个 docx 文件失败`))
    }
    return sentence(text(`编辑 ${normalizedCount} 个 docx 文件失败`))
  }
  if (skillKey === 'file-read') {
    if (status === 'running') return sentence(text(`正在读取 ${normalizedCount} 个文件`))
    if (status === 'completed') return sentence(text(`已读取 ${normalizedCount} 个文件`))
    if (status === 'partial_failed') {
      return sentence(text(`部分读取 ${normalizedCount} 个文件失败`))
    }
    return sentence(text(`读取 ${normalizedCount} 个文件失败`))
  }
  if (skillKey === 'file-write') {
    if (status === 'running') return sentence(text(`正在编辑 ${normalizedCount} 个文件`))
    if (status === 'completed') return sentence(text(`已编辑 ${normalizedCount} 个文件`))
    if (status === 'partial_failed') {
      return sentence(text(`部分编辑 ${normalizedCount} 个文件失败`))
    }
    return sentence(text(`编辑 ${normalizedCount} 个文件失败`))
  }
  if (skillKey === 'pdf-read') {
    if (status === 'running') return sentence(text(`正在读取 ${normalizedCount} 个 PDF 文件`))
    if (status === 'completed') return sentence(text(`已读取 ${normalizedCount} 个 PDF 文件`))
    if (status === 'partial_failed')
      return sentence(text(`部分读取 ${normalizedCount} 个 PDF 文件失败`))
    return sentence(text(`读取 ${normalizedCount} 个 PDF 文件失败`))
  }
  if (skillKey === 'ppt') {
    if (status === 'running') return sentence(text(`正在处理 ${normalizedCount} 个 PPT 文件`))
    if (status === 'completed') return sentence(text(`已处理 ${normalizedCount} 个 PPT 文件`))
    if (status === 'partial_failed')
      return sentence(text(`部分处理 ${normalizedCount} 个 PPT 文件失败`))
    return sentence(text(`处理 ${normalizedCount} 个 PPT 文件失败`))
  }
  if (skillKey === 'kb') {
    if (status === 'running') return sentence(text('正在检索知识库'))
    if (status === 'completed') return sentence(text('已检索知识库'))
    if (status === 'partial_failed') return sentence(text('部分知识库检索失败'))
    return sentence(text('检索知识库失败'))
  }
  if (skillKey === 'terminal') {
    if (status === 'running') return sentence(text('正在执行终端指令'))
    if (status === 'completed') return sentence(text('已执行终端指令'))
    if (status === 'partial_failed') return sentence(text('部分终端指令执行失败'))
    return sentence(text('执行终端指令失败'))
  }
  if (skillKey === 'web-search') {
    if (status === 'running') return sentence(text('正在搜索网页'))
    if (status === 'completed') return sentence(text('已搜索网页'))
    if (status === 'partial_failed') return sentence(text('部分网页搜索失败'))
    return sentence(text('搜索网页失败'))
  }
  if (skillKey === 'web-crawl') {
    if (status === 'running') return sentence(text('正在读取网页'))
    if (status === 'completed') return sentence(text('已读取网页'))
    if (status === 'partial_failed') return sentence(text('部分网页读取失败'))
    return sentence(text('读取网页失败'))
  }
  if (skillKey === 'browser') {
    if (status === 'running') return sentence(text('正在操作浏览器'))
    if (status === 'completed') return sentence(text(`已操作浏览器 ${normalizedCount} 次`))
    if (status === 'partial_failed') return sentence(text('部分浏览器操作失败'))
    return sentence(text('浏览器操作失败'))
  }
  if (skillKey === 'image-recognition') {
    if (status === 'running') return sentence(text('正在识别图片'))
    if (status === 'completed') return sentence(text('已识别图片'))
    if (status === 'partial_failed') return sentence(text('部分图片识别失败'))
    return sentence(text('图片识别失败'))
  }
  if (skillKey === 'wait') {
    if (status === 'running') return sentence(text('正在等待'))
    if (status === 'completed') return sentence(text('已等待'))
    if (status === 'partial_failed') return sentence(text('部分等待失败'))
    return sentence(text('等待失败'))
  }
  if (status === 'running') return sentence(text('正在处理任务'))
  if (status === 'completed') return sentence(text('已处理任务'))
  if (status === 'partial_failed') return sentence(text('部分任务处理失败'))
  return sentence(text('处理任务失败'))
}

const getToolItemText = (
  toolName: AssistantToolName,
  _status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] => {
  const fileLabel = readToolFileLabel(input)
  const queryLabel = readToolQueryLabel(input)
  const commandLabel = readCommandLabel(input)
  const urlLabel = readWebUrlLabel(input)
  const instructionLabel = readInstructionLabel(input)
  const browserAction = input ? readStringValue(input, 'action') || '' : ''
  const waitLabel = readWaitDurationLabel(input)

  if (toolName === 'docx_outline') {
    return sentence(text('查看文档 '), text(fileLabel), text(' 的结构'))
  }
  if (toolName === 'docx_read_blocks') {
    const rangeText = readDocxRangeLabel(input)
    return sentence(text('读取文档 '), text(fileLabel), text(` ${rangeText}`))
  }
  if (toolName === 'docx_edit') {
    return sentence(text('编辑文档 '), text(fileLabel))
  }
  if (toolName === 'file_read') {
    return sentence(text('读取文件 '), text(fileLabel))
  }
  if (toolName === 'file_write') {
    return sentence(text('编辑文件 '), text(fileLabel))
  }
  if (toolName === 'pdf_inspect') {
    return sentence(text('查看 PDF 信息 '), text(fileLabel))
  }
  if (toolName === 'pdf_read_pages') {
    return sentence(text('读取 PDF 页面 '), text(fileLabel))
  }
  if (toolName === 'pdf_render_pages') {
    return sentence(text('渲染 PDF 页面 '), text(fileLabel))
  }
  if (toolName === 'ppt_outline') return sentence(text('阅读 PPT 结构 '), text(fileLabel))
  if (toolName === 'ppt_read_slides') return sentence(text('读取 PPT 页面 '), text(fileLabel))
  if (toolName === 'ppt_search') return sentence(text('搜索 PPT '), text(queryLabel))
  if (toolName === 'ppt_render') return sentence(text('渲染 PPT 页面 '), text(fileLabel))
  if (toolName === 'ppt_edit') return sentence(text('编辑 PPT '), text(fileLabel))
  if (toolName === 'terminal_run') {
    return sentence(text('执行命令 '), text(commandLabel))
  }
  if (toolName === 'terminal_read') {
    return sentence(
      text('读取终端 '),
      text(readStringValue(input || {}, 'terminalId') || '运行结果')
    )
  }
  if (toolName === 'terminal_stop') {
    return sentence(text('停止终端 '), text(readStringValue(input || {}, 'terminalId') || '任务'))
  }
  if (toolName === 'kb_search' || toolName === 'docx_search' || toolName === 'pdf_search') {
    return sentence(
      text(toolName === 'kb_search' ? '在知识库中搜索 ' : '在文档中搜索 '),
      text(queryLabel)
    )
  }
  if (toolName === 'kb_list_documents') {
    return sentence(text('查看工作空间文档列表'))
  }
  if (toolName === 'web_search') {
    return sentence(text('搜索网页 '), text(queryLabel))
  }
  if (toolName === 'web_crawl') {
    return sentence(text('读取网页 '), text(urlLabel))
  }
  if (toolName === 'browser_use') {
    if (browserAction === 'navigate') return sentence(text('打开网页 '), text(urlLabel))
    if (browserAction === 'observe') return sentence(text('查看页面并'), text(instructionLabel))
    if (browserAction === 'extract') return sentence(text('从页面中'), text(instructionLabel))
    if (browserAction === 'act') return sentence(text('在页面上'), text(instructionLabel))
    return sentence(text('操作浏览器 '), text(instructionLabel))
  }
  if (toolName === 'llm_recognize') {
    return sentence(text('识别图片 '), text(fileLabel))
  }
  if (toolName === 'wait_time') {
    return sentence(text('等待 '), text(waitLabel))
  }
  return sentence(text('处理任务中的一步'))
}

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

type ExecutionActionSummary = {
  kind: AssistantProcessSkillKey
  fileLabels: Set<string>
  count: number
  statuses: AssistantProcessStatus[]
  waitLabels: Set<string>
}

const getExecutionStatus = (groups: AssistantProcessGroup[]): AssistantProcessStatus => {
  return getMixedStatus(groups.map((group) => group.status))
}

export const buildAssistantExecutionSummaryText = (
  groups: AssistantProcessGroup[]
): AssistantRichTextSegment[] => {
  const summaries = new Map<AssistantProcessSkillKey, ExecutionActionSummary>()
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
      const kind = entry.toolName ? getToolUiKind(entry.toolName) : group.skillKey
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
      if (kind === 'docx-read' || kind === 'docx-edit' || kind === 'ppt') {
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
    if (status === 'running') return sentence(text(`正在执行 ${totalCount} 项操作`))
    if (status === 'completed') return sentence(text(`已完成 ${totalCount} 项操作`))
    if (status === 'partial_failed') return sentence(text(`${totalCount} 项操作中有部分失败`))
    return sentence(text(`${totalCount} 项操作执行失败`))
  }

  return ordered.flatMap((summary, index) => {
    const count = summary.fileLabels.size || summary.count || 1
    const summaryStatus = getMixedStatus(summary.statuses, status)
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
    return sentence(text(prefix), ...getToolSummaryText(summary.kind, summaryStatus, count))
  })
}

export const resolveAssistantExecutionIcon = (
  groups: AssistantProcessGroup[]
): AssistantProcessIconKind => {
  const kinds = new Set(
    groups.flatMap((group) =>
      group.items.length > 0
        ? group.items.map((item) => (item.toolName ? getToolUiKind(item.toolName) : group.skillKey))
        : [group.skillKey]
    )
  )
  if (kinds.size !== 1) return 'workflow'
  return getToolIconKind([...kinds][0] || 'generic')
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
    partialFailedText: getDisplayGroupText(input.display, 'partial_failed'),
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

export const readWorkbenchAiPreference = (
  storage: WorkbenchPreferenceStorage
): WorkbenchAiPreference => {
  const stored = storage.getItem(WORKBENCH_PREFERENCE_AI_PREFERENCE_STORAGE_KEY)
  return isWorkbenchAiPreference(stored) ? stored : 'default'
}

export const writeWorkbenchAiPreference = (
  storage: WorkbenchPreferenceStorage,
  preference: WorkbenchAiPreference
): void => {
  storage.setItem(WORKBENCH_PREFERENCE_AI_PREFERENCE_STORAGE_KEY, preference)
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
    const parsed = JSON.parse(raw) as {
      mainModel?: WorkbenchSelectedModel | null
      visionModel?: WorkbenchSelectedModel | null
    }
    if (!parsed.mainModel?.configId || !parsed.mainModel.modelName) return null
    return {
      mainModel: parsed.mainModel,
      visionModel:
        parsed.visionModel?.configId && parsed.visionModel.modelName ? parsed.visionModel : null
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

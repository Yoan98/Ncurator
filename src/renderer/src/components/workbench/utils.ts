import type {
  AiRunEvent,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  SearchResult
} from '../../../../shared/types'
import type { AssistantProcessItem, WorkbenchFileRef } from './types'

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

export const getAssistantToolNarrative = (toolName?: string): string => {
  if (!toolName) return '俺在继续处理任务'
  if (toolName === 'terminal_run' || toolName === 'terminal') return '俺在跑命令呢，等等俺'
  if (toolName === 'docx_edit') return '俺正在写 docx 中'
  if (toolName === 'docx_search') return '俺在 docx 里找相关内容'
  if (
    toolName === 'docx_read_blocks' ||
    toolName === 'docx_outline' ||
    toolName === 'docx_history'
  ) {
    return '俺在读 docx 内容'
  }
  if (toolName === 'kb_search' || toolName === 'kb_list_documents') return '俺在资料里找线索'
  if (toolName.includes('search')) return '俺在找相关线索'
  if (toolName.includes('read')) return '俺在读取资料'
  if (toolName.includes('write') || toolName.includes('edit')) return '俺正在写文件'
  if (toolName.includes('command') || toolName.includes('terminal')) return '俺在跑命令呢，等等俺'
  return '俺在调用工具处理任务'
}

export const buildAssistantProcessText = (event: AiRunEvent): string | null => {
  if (event.type === 'human_step') {
    if (event.toolName) return getAssistantToolNarrative(event.toolName)
    if (event.action === 'learn_skill') return '俺在补齐要用的能力'
    if (event.action === 'deliver_result') return '俺在整理最后的回答'
    if (event.publicNarrative.trim()) return event.publicNarrative
    return event.summary || '俺在判断下一步怎么做'
  }
  if (event.type === 'tool_call_started') return getAssistantToolNarrative(event.toolName)
  if (event.type === 'tool_call_result') {
    if (event.error || event.result?.ok === false) return '这一步没跑通，俺在换个办法'
    return '这一步处理完了'
  }
  if (event.type === 'context_compaction_started') return '内容有点多，俺先整理下上下文'
  if (event.type === 'context_compaction_completed') return '上下文整理好了，俺继续'
  if (event.type === 'file_artifact') return '文件处理好了，俺放到修改记录里了'
  if (event.type === 'workspace_required') return '这一步需要先补充工作区'
  if (event.type === 'runtime_issue') return event.message || '当前运行被阻塞了'
  if (event.type === 'approval_batch_required') return '这一步要你确认后俺才能继续'
  if (event.type === 'approval_batch_decision') return '审核结果俺收到了'
  if (event.type === 'run_failed') return '任务失败了，俺把原因放下面'
  if (event.type === 'run_cancelled') return '任务已取消'
  if (event.type === 'run_completed') return '处理完成'
  return null
}

export const createAssistantThinkingItem = (messageId: string): AssistantProcessItem => ({
  id: `${messageId}:thinking`,
  text: '让俺想想',
  status: 'running',
  createdAt: Date.now(),
  sourceEventType: 'thinking'
})

export const createAssistantProcessItem = (
  event: AiRunEvent,
  options?: { id?: string; text?: string }
): AssistantProcessItem | null => {
  const text = options?.text || buildAssistantProcessText(event)
  if (!text) return null
  const fallbackId =
    event.type === 'human_step'
      ? `${event.taskId}:${event.stepIndex}`
      : event.type === 'tool_call_started' || event.type === 'tool_call_result'
        ? event.toolCallId
        : event.type === 'file_artifact'
          ? event.artifactId
          : `${event.runId}:${event.type}`
  const status =
    event.type === 'approval_batch_required' || event.type === 'workspace_required'
      ? 'waiting'
      : event.type === 'run_failed' ||
          event.type === 'run_cancelled' ||
          event.type === 'runtime_issue' ||
          (event.type === 'tool_call_result' && (event.error || event.result?.ok === false))
        ? 'failed'
        : event.type === 'tool_call_started' || event.type === 'context_compaction_started'
          ? 'running'
          : 'completed'

  return {
    id: options?.id || fallbackId,
    text,
    status,
    createdAt:
      'createdAt' in event
        ? event.createdAt
        : 'completedAt' in event
          ? event.completedAt
          : 'decidedAt' in event
            ? event.decidedAt
            : Date.now(),
    sourceEventType: event.type
  }
}

export const mergeAssistantProcessItem = (
  current: AssistantProcessItem[],
  next: AssistantProcessItem
): AssistantProcessItem[] => {
  const nextItems = current.filter((item) => item.id !== next.id)
  if (next.status !== 'running') {
    return [
      ...nextItems.map((item) =>
        item.status === 'running' ? { ...item, status: 'completed' as const } : item
      ),
      next
    ]
  }
  return [...nextItems, next]
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

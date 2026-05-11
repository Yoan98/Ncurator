import type {
  FileReviewChange,
  FileReview,
  FileReviewRenderKind,
  DraftTextDiffHunk,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  SearchResult
} from '../../../../shared/types'
import type { AssistantTurnStep, WorkbenchFileRef } from './types'

const TOOL_LABEL_MAP: Record<string, string> = {
  kb_search: 'search',
  kb_list_documents: 'search',
  docx_search: 'search',
  docx_read_blocks: 'read',
  docx_outline: 'read',
  docx_history: 'read',
  docx_create: 'edit',
  docx_paragraph_edit: 'edit',
  docx_heading_edit: 'edit',
  docx_table_edit: 'edit',
  docx_text_edit: 'edit',
  docx_text_style_edit: 'edit',
  terminal_run: 'command',
  read_file: 'read',
  write_file: 'edit',
  edit_file: 'edit',
  run_command: 'command',
  terminal: 'command',
  preview: 'preview',
  validate: 'validate'
}

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

export const getToolBadge = (toolName?: string, action?: string): string => {
  if (!toolName && !action) return 'step'
  if (toolName && TOOL_LABEL_MAP[toolName]) return TOOL_LABEL_MAP[toolName]
  if (action === 'call_tool') return 'tool'
  if (action === 'deliver_result') return 'deliver'
  if (action === 'learn_skill') return 'learn'
  return toolName || action || 'step'
}

export const dedupeFileRefs = (items: WorkbenchFileRef[]): WorkbenchFileRef[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.origin}:${item.path}:${item.reviewId || ''}`
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

export const getStepFiles = (step: AssistantTurnStep): WorkbenchFileRef[] => {
  return dedupeFileRefs(step.files)
}

export const getReviewRenderKind = (document: FileReview): FileReviewRenderKind => {
  if (document.review_render_kind) return document.review_render_kind
  if (document.format === 'docx') return 'docx_block'
  if (document.format === 'md' || document.format === 'txt') return 'text_hunk'
  if (document.format === 'xlsx') return 'sheet_range'
  if (document.format === 'pptx') return 'slide_element'
  return 'preview_only'
}

export const formatLocatorSummary = (change: FileReviewChange): string => {
  const locator = change.locator
  if (!locator) return '定位信息未结构化'
  const section = typeof locator.section === 'string' ? locator.section : null
  const heading = typeof locator.heading === 'string' ? locator.heading : null
  const blockId = typeof locator.blockId === 'string' ? locator.blockId : null
  const action = typeof locator.action === 'string' ? locator.action : null
  const paragraphIndex =
    typeof locator.paragraphIndex === 'number'
      ? `第 ${locator.paragraphIndex + 1} 段`
      : null
  const rowIndex =
    typeof locator.rowIndex === 'number' ? `第 ${locator.rowIndex + 1} 行` : null
  const columnIndex =
    typeof locator.columnIndex === 'number'
      ? `第 ${locator.columnIndex + 1} 列`
      : null

  return (
    [section, heading, paragraphIndex, rowIndex, columnIndex, blockId, action]
      .filter(Boolean)
      .join(' / ') ||
    '定位信息未结构化'
  )
}

export const buildFallbackDiffHunks = (change: FileReviewChange): DraftTextDiffHunk[] => {
  if (change.diff_hunks && change.diff_hunks.length > 0) return change.diff_hunks
  const beforeLines = String(change.before_text || '').split('\n')
  const afterLines = String(change.after_text || '').split('\n')
  return [
    {
      id: change.id,
      title: change.title,
      summary: change.summary,
      lines: [
        ...beforeLines.map((value) => ({ type: 'removed' as const, value })),
        ...afterLines.map((value) => ({ type: 'added' as const, value }))
      ]
    }
  ]
}

export const buildUnifiedDiffText = (change: FileReviewChange): string => {
  return buildFallbackDiffHunks(change)
    .flatMap((hunk) =>
      hunk.lines.map(
        (line) =>
          `${line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}${line.value}`
      )
    )
    .join('\n')
}

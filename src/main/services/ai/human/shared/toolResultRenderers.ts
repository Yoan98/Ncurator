import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { clipText } from '../../utils/text'
import type { ToolCallResult } from '../types'

const TOOL_RESULT_TEXT_LIMIT = 220

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const toInlineText = (value: string): string =>
  clipText(value.trim().replace(/\s+/g, ' '), TOOL_RESULT_TEXT_LIMIT)

const toStringList = (value: JsonValue | undefined): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []

const readStringField = (obj: JsonObject, key: string): string | undefined => {
  const value = obj[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

const readNumberField = (obj: JsonObject, key: string): number | undefined => {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const readBooleanField = (obj: JsonObject, key: string): boolean | undefined => {
  const value = obj[key]
  return typeof value === 'boolean' ? value : undefined
}

const renderDocxOutlinePreview = (obj: JsonObject): string | undefined => {
  const blockCount =
    readNumberField(obj, 'returnedBlockCount') ??
    readNumberField(obj, 'blockCount') ??
    (Array.isArray(obj.blocks) ? obj.blocks.length : undefined)
  const truncated = readBooleanField(obj, 'truncated')

  if (typeof blockCount !== 'number' || typeof truncated !== 'boolean') {
    return undefined
  }

  return truncated
    ? `返回 ${String(blockCount)} 个结构块（结果已截断，文档后续内容未包含）`
    : `返回 ${String(blockCount)} 个结构块`
}

const renderRowPreview = (value: JsonValue): string | undefined => {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? toInlineText(text) : undefined
  }

  if (!isJsonObject(value)) return undefined

  const name =
    readStringField(value, 'document_name') ||
    readStringField(value, 'name') ||
    readStringField(value, 'id') ||
    readStringField(value, 'docId') ||
    readStringField(value, 'blockId')
  const text =
    readStringField(value, 'text') ||
    readStringField(value, 'preview') ||
    readStringField(value, 'outputPreview') ||
    readStringField(value, 'stdoutPreview') ||
    readStringField(value, 'error') ||
    readStringField(value, 'message') ||
    readStringField(value, 'summary')

  if (name && text) return `${name}: ${toInlineText(text)}`
  if (text) return toInlineText(text)
  if (name) return name
  return undefined
}

const renderArrayPreview = (items: JsonValue[]): string | undefined => {
  if (items.length === 0) return '返回 0 项'

  const previews = items
    .map((item) => renderRowPreview(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3)

  if (previews.length === 0) {
    return `返回 ${items.length} 项`
  }

  return `返回 ${items.length} 项：${previews.join(' | ')}`
}

const renderObjectPreview = (obj: JsonObject): string | undefined => {
  const directText =
    readStringField(obj, 'outputPreview') ||
    readStringField(obj, 'stdoutPreview') ||
    readStringField(obj, 'error') ||
    readStringField(obj, 'message') ||
    readStringField(obj, 'text')

  if (directText) {
    return toInlineText(directText)
  }

  const outlinePreview = renderDocxOutlinePreview(obj)
  if (outlinePreview) {
    return outlinePreview
  }

  const nestedBlock = isJsonObject(obj.block) ? renderRowPreview(obj.block) : undefined
  if (nestedBlock) return nestedBlock

  const collection =
    (Array.isArray(obj.items) && obj.items) ||
    (Array.isArray(obj.matches) && obj.matches) ||
    (Array.isArray(obj.blocks) && obj.blocks) ||
    (Array.isArray(obj.changedBlocks) && obj.changedBlocks) ||
    (Array.isArray(obj.problems) && obj.problems)
  if (collection) {
    return renderArrayPreview(collection)
  }

  const singlePreview = renderRowPreview(obj)
  if (singlePreview) return singlePreview

  const pathLike =
    readStringField(obj, 'previewPath') ||
    readStringField(obj, 'outPath') ||
    readStringField(obj, 'sourcePath') ||
    readStringField(obj, 'path')
  if (pathLike) return pathLike

  const docId = readStringField(obj, 'docId')
  if (docId) return `docId=${docId}`

  const warnings = toStringList(obj.warnings)
  if (warnings.length > 0) {
    return `warnings=${warnings.map((item) => toInlineText(item)).join(' | ')}`
  }

  return undefined
}

const renderResourceContextPreview = (result: ToolCallResult): string | undefined => {
  const resourceContext = result.resourceContext
  if (!resourceContext || resourceContext.family !== 'docx' || !resourceContext.sourcePath) {
    return undefined
  }

  const parts = [`在 ${resourceContext.sourcePath} 上执行`]
  if (resourceContext.effectKind === 'opened') {
    parts[0] = `初始化文档会话 ${resourceContext.sourcePath}`
  } else if (resourceContext.effectKind === 'rolled_back') {
    parts[0] = `在 ${resourceContext.sourcePath} 上回退版本`
  } else if (resourceContext.effectKind === 'history') {
    parts[0] = `查看 ${resourceContext.sourcePath} 的版本历史`
  } else if (resourceContext.effectKind === 'mutated') {
    parts[0] = `在 ${resourceContext.sourcePath} 上应用编辑`
  } else if (resourceContext.effectKind === 'searched') {
    parts[0] = `在 ${resourceContext.sourcePath} 上搜索`
  } else if (resourceContext.effectKind === 'read') {
    parts[0] = `读取 ${resourceContext.sourcePath}`
  }

  if (resourceContext.previousVersionRef) {
    parts.push(`上一版本 ${resourceContext.previousVersionRef}`)
  }
  if (resourceContext.currentVersionRef) {
    parts.push(`当前版本 ${resourceContext.currentVersionRef}`)
  }
  return parts.join('；')
}

export const renderToolResultDataPreview = (result: ToolCallResult): string | undefined => {
  const resourceContextPreview = renderResourceContextPreview(result)
  if (resourceContextPreview) {
    const value = result.data
    const objectPreview = isJsonObject(value) ? renderObjectPreview(value) : undefined
    if (objectPreview && objectPreview !== resourceContextPreview) {
      return `${resourceContextPreview}；${objectPreview}`
    }
    return resourceContextPreview
  }

  const value = result.data
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? toInlineText(text) : undefined
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) return 'null'

  if (Array.isArray(value)) return renderArrayPreview(value)

  if (isJsonObject(value)) return renderObjectPreview(value)

  return undefined
}

export const renderToolDiagnosticText = (result: ToolCallResult): string => {
  if (!result.diagnostic) return ''
  return `；diagnostic=${toInlineText(result.diagnostic.message)}`
}

export const buildToolCallDisplayText = (
  result: Pick<ToolCallResult, 'toolName' | 'ok'>
): string => `调用工具 ${result.toolName}（${result.ok ? '成功' : '失败'}）`

export const resolveToolResultErrorText = (result: Pick<ToolCallResult, 'code' | 'data'>): string => {
  if (isJsonObject(result.data)) {
    const explicit =
      readStringField(result.data, 'error') ||
      readStringField(result.data, 'message') ||
      readStringField(result.data, 'outputPreview')
    if (explicit) return explicit
  }

  if (typeof result.data === 'string' && result.data.trim()) {
    return result.data.trim()
  }

  return `tool call failed (${result.code})`
}

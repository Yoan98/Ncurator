import { createHash } from 'node:crypto'
import { jsonrepair } from 'jsonrepair'

type ErrorObject = Record<string, unknown>
type ErrorResponseData = string | number | boolean | null | object

export type StructuredOutputErrorInfo = {
  status?: number
  code?: string
  type?: string
  param?: string
  message: string
  rawText: string
  hasProviderSignal: boolean
}

const getObject = (value: unknown): ErrorObject | undefined =>
  value && typeof value === 'object' ? (value as ErrorObject) : undefined

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const stringifyValue = (value: unknown): string | undefined => {
  const direct = readString(value)
  if (direct) return direct
  if (value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const stripSdkErrorDecoration = (message: string): string =>
  message.replace(/\n\s*Troubleshooting URL:\s*https?:\/\/\S+[\s\S]*$/iu, '').trim()

export const normalizeStructuredOutputError = (error: unknown): StructuredOutputErrorInfo => {
  const root = getObject(error)
  const response = getObject(root?.response)
  const responseData = response?.data as ErrorResponseData | undefined
  const responseDataObject = getObject(responseData)
  const providerError = getObject(responseDataObject?.error)

  const message = stripSdkErrorDecoration(
    readString(providerError?.message) ||
      readString(responseDataObject?.message) ||
      readString(root?.message) ||
      stringifyValue(responseData) ||
      stringifyValue(error) ||
      'unknown structured output error'
  )

  const status =
    readNumber(response?.status) ||
    readNumber(root?.status) ||
    readNumber(root?.httpStatus) ||
    readNumber(responseDataObject?.status) ||
    readNumber(providerError?.status)

  const code =
    readString(providerError?.code) ||
    readString(responseDataObject?.code) ||
    readString(root?.providerCode) ||
    (readString(root?.code) === 'CANCELLED' ? undefined : readString(root?.code))

  const type =
    readString(providerError?.type) ||
    readString(responseDataObject?.type) ||
    readString(root?.providerType) ||
    readString(root?.type)

  const param =
    readString(providerError?.param) ||
    readString(responseDataObject?.param) ||
    readString(root?.param)

  const hasProviderSignal =
    status !== undefined ||
    Boolean(
      code ||
        type ||
        readString(providerError?.message) ||
        readString(responseDataObject?.message) ||
        readString(root?.providerCode) ||
        readNumber(root?.httpStatus) !== undefined
    )

  const rawParts = [
    status !== undefined ? `status=${status}` : undefined,
    code ? `code=${code}` : undefined,
    type ? `type=${type}` : undefined,
    param ? `param=${param}` : undefined,
    message,
    stringifyValue(responseData)
  ].filter(Boolean)

  return {
    status,
    code,
    type,
    param,
    message,
    rawText: rawParts.join(' '),
    hasProviderSignal
  }
}

export const getErrorText = (error: unknown): string =>
  normalizeStructuredOutputError(error).message

export const extractTextContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        if ('text' in part && typeof part.text === 'string') return part.text
        if ('content' in part && typeof part.content === 'string') return part.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    if ('text' in content && typeof content.text === 'string') {
      return content.text
    }
    if ('content' in content && typeof content.content === 'string') {
      return content.content
    }
  }

  return ''
}

const summarizeImageUrl = (url: string): string => {
  if (!url.startsWith('data:')) return url
  const separator = url.indexOf(',')
  const header = separator >= 0 ? url.slice(0, separator) : 'data:'
  return `${header};sha256=${createHash('sha256').update(url).digest('hex')};length=${url.length}`
}

export const serializeMessageContentForTelemetry = (content: unknown): string => {
  const summarize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(summarize)
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    const imageUrl = record.image_url
    if (typeof imageUrl === 'string') {
      return { ...record, image_url: summarizeImageUrl(imageUrl) }
    }
    if (imageUrl && typeof imageUrl === 'object') {
      const imageRecord = imageUrl as Record<string, unknown>
      return {
        ...record,
        image_url: {
          ...imageRecord,
          ...(typeof imageRecord.url === 'string'
            ? { url: summarizeImageUrl(imageRecord.url) }
            : {})
        }
      }
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, summarize(item)]))
  }
  if (typeof content === 'string') return content
  return JSON.stringify(summarize(content))
}

export const normalizePromptJsonText = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

const parseJsonObject = (normalized: string): Record<string, unknown> => {
  const parsed = JSON.parse(normalized) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('structured_output_non_object_response')
  }
  return parsed as Record<string, unknown>
}

const parseRepairableJsonObjectText = (raw: string, emptyCode: string): Record<string, unknown> => {
  const normalized = normalizePromptJsonText(raw)
  if (!normalized) {
    throw new Error(emptyCode)
  }

  try {
    return parseJsonObject(normalized)
  } catch (error) {
    try {
      return parseJsonObject(jsonrepair(normalized))
    } catch {
      throw error
    }
  }
}

export const parsePromptJsonOutput = (raw: string): Record<string, unknown> => {
  return parseRepairableJsonObjectText(raw, 'prompt_json_empty_response')
}

export const parseJsonObjectText = (raw: string): Record<string, unknown> => {
  return parseRepairableJsonObjectText(raw, 'structured_output_empty_response')
}

export type JsonRepairResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

const resolveJsonParseErrorMessage = (error: unknown): string => {
  const message = error instanceof Error && error.message.trim() ? error.message : ''
  if (message === 'structured_output_non_object_response') {
    return 'arguments 解析成功但不是 JSON 对象。'
  }
  return message || '无法解析 JSON。'
}

const JSON_PARSE_POSITION_PATTERN = /at position (\d+)(?: \(line \d+ column \d+\))?/i

export const extractJsonErrorPosition = (errorMessage: string): number | undefined => {
  const match = JSON_PARSE_POSITION_PATTERN.exec(errorMessage)
  if (!match) return undefined
  const position = Number(match[1])
  return Number.isFinite(position) ? position : undefined
}

const extractContextAroundPosition = (raw: string, position: number, windowSize = 30): string => {
  if (!raw) return ''
  const from = Math.max(0, position - windowSize)
  const to = Math.min(raw.length, position + windowSize)
  if (from >= to) return raw
  const prefix = from > 0 ? '…' : ''
  const suffix = to < raw.length ? '…' : ''
  return `${prefix}${raw.slice(from, to)}${suffix}`
}

// 生成增强后的 JSON 解析失败诊断：错误消息 + 出错位置上下文。
export const buildJsonErrorDiagnosis = (raw: string, errorMessage: string): string => {
  const position = extractJsonErrorPosition(errorMessage)
  if (position === undefined) return errorMessage

  const context = extractContextAroundPosition(raw, position)
  return `${errorMessage}；出错位置附近：${context}`
}

// LangChain 在解析模型 tool call 的 `arguments` 时只做一次 `JSON.parse`：
// 成功 → 放进 `message.tool_calls`；失败 → 放进 `message.invalid_tool_calls`，
// 并在 `invalidCall.error` 里塞入一段面向 SDK 开发者的错误文案（含原始 args 回显、
// `are not valid JSON.` 以及 `Troubleshooting URL: https://docs.langchain.com/...`）。
// 那段 `error` 对模型毫无价值，还会把文档链接泄漏进工具反馈，因此这里不读取它：
// 只取 `invalidCall.args` 原始字符串，先用 jsonrepair 修复再解析；失败时由我们自己
// 生成干净的错误信息（附带出错位置上下文），避免任何 LangChain SDK 噪音进入模型上下文。
export const tryRepairJsonObject = (raw: string | undefined): JsonRepairResult => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'arguments 为空，无法解析。' }
  }
  try {
    return { ok: true, value: parseRepairableJsonObjectText(raw, 'repair_empty_response') }
  } catch (error) {
    const baseError = resolveJsonParseErrorMessage(error)
    return { ok: false, error: buildJsonErrorDiagnosis(raw, baseError) }
  }
}

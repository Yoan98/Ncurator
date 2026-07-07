import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { ToolCallResult, ToolResourceContext } from '../types'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeText = (value: string): string => value.trim().replace(/\s+/g, ' ')

const readStringField = (obj: JsonObject, key: string): string | undefined => {
  const value = obj[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

const readNumberField = (obj: JsonObject, key: string): number | undefined => {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const readNumberTextField = (obj: JsonObject, key: string): string | undefined => {
  const value = readNumberField(obj, key)
  return typeof value === 'number' ? String(value) : undefined
}

const renderPrimitive = (value: JsonValue | undefined): string | undefined => {
  if (typeof value === 'string') {
    const text = normalizeText(value)
    return text || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return undefined
}

const renderKeyValuePairs = (pairs: Array<[string, string | undefined]>): string => {
  const parts = pairs
    .map(([label, value]) => {
      const text = String(value || '').trim()
      return text ? `${label}=${text}` : ''
    })
    .filter(Boolean)
  return parts.join('；')
}

const renderGenericArrayItem = (value: JsonValue, index: number): string => {
  const primitive = renderPrimitive(value)
  if (primitive) return `${index + 1}. ${primitive}`

  if (isJsonObject(value)) {
    const name =
      readStringField(value, 'blockId')
      || readStringField(value, 'document_name')
      || readStringField(value, 'name')
      || readStringField(value, 'id')
      || readStringField(value, 'docId')
    const text =
      readStringField(value, 'text')
      || readStringField(value, 'preview')
      || readStringField(value, 'summary')
      || readStringField(value, 'message')
      || readStringField(value, 'error')
      || readStringField(value, 'stdout')
      || readStringField(value, 'stderr')
      || readStringField(value, 'beforeText')
      || readStringField(value, 'afterText')

    const inline = renderKeyValuePairs([
      ['name', name],
      ['text', text]
    ])
    if (inline) return `${index + 1}. ${inline}`
  }

  return `${index + 1}. ${JSON.stringify(value)}`
}

const renderGenericArray = (items: JsonValue[]): string =>
  items.length > 0 ? items.map(renderGenericArrayItem).join('\n') : '返回 0 项'

const renderObjectFieldValue = (value: JsonValue): string | undefined => {
  const primitive = renderPrimitive(value)
  if (primitive) return primitive
  if (Array.isArray(value)) return renderGenericArray(value)
  if (isJsonObject(value)) return renderGenericObject(value)
  return undefined
}

const renderGenericObject = (obj: JsonObject): string => {
  return Object.entries(obj)
    .map(([key, value]) => {
      const rendered = renderObjectFieldValue(value)
      if (!rendered) return ''
      return rendered.includes('\n') ? `${key}:\n${rendered}` : `${key}=${rendered}`
    })
    .filter(Boolean)
    .join('\n')
}

const renderDocxParagraphRuns = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `  - run ${index + 1}：${renderKeyValuePairs([
        ['text', readStringField(item, 'text')],
        ['bold', renderPrimitive(item.bold)],
        ['italic', renderPrimitive(item.italic)],
        ['underline', renderPrimitive(item.underline)]
      ])}`
    })
    .join('\n')
}

const renderDocxParagraphs = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      const blockLine = renderDocxBlockLine(item, index)
      const runs = Array.isArray(item.runs) ? `\n  runs:\n${renderDocxParagraphRuns(item.runs)}` : ''
      return `${blockLine}${runs}`
    })
    .join('\n')
}

const renderDocxTableCells = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      const cellHeader = `  - cell ${index + 1}：${renderKeyValuePairs([
        ['blockId', readStringField(item, 'blockId')],
        ['row', readNumberTextField(item, 'row')],
        ['col', readNumberTextField(item, 'col')]
      ])}`
      const paragraphs = Array.isArray(item.paragraphs)
        ? `\n    paragraphs:\n${renderDocxParagraphs(item.paragraphs)
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n')}`
        : ''
      return `${cellHeader}${paragraphs}`
    })
    .join('\n')
}

const renderDocxBlockLine = (value: JsonValue, index: number): string => {
  if (!isJsonObject(value)) return renderGenericArrayItem(value, index)

  const blockId = readStringField(value, 'blockId') || `item-${index + 1}`
  const type = readStringField(value, 'type')
  const blockIndex = readNumberField(value, 'blockIndex')
  const text =
    readStringField(value, 'text')
    || readStringField(value, 'summary')
    || readStringField(value, 'message')
    || ''
  const extra =
    renderKeyValuePairs([
      ['type', type],
      ['blockIndex', typeof blockIndex === 'number' ? String(blockIndex) : undefined]
    ]) || undefined

  const baseLine = `- ${blockId}${extra ? `（${extra}）` : ''}：${text || JSON.stringify(value)}`
  if (type === 'paragraph' && Array.isArray(value.runs)) {
    return `${baseLine}\n  runs:\n${renderDocxParagraphRuns(value.runs)}`
  }
  if (type === 'table' && Array.isArray(value.cells)) {
    return `${baseLine}\n  cells:\n${renderDocxTableCells(value.cells)}`
  }
  if (type === 'table_cell' && Array.isArray(value.paragraphs)) {
    return `${baseLine}\n  paragraphs:\n${renderDocxParagraphs(value.paragraphs)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`
  }

  return baseLine
}

const renderDocxBlocks = (value: JsonValue | undefined): string =>
  Array.isArray(value) && value.length > 0
    ? value.map(renderDocxBlockLine).join('\n')
    : 'none'

const renderDocxSearchMatches = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      const blockId = readStringField(item, 'blockId') || `item-${index + 1}`
      const blockType = readStringField(item, 'type')
      const blockIndex = readNumberField(item, 'blockIndex')
      const text = readStringField(item, 'text') || JSON.stringify(item)
      const meta =
        renderKeyValuePairs([
          ['type', blockType],
          ['blockIndex', typeof blockIndex === 'number' ? String(blockIndex) : undefined]
        ]) || undefined
      return `- ${blockId}${meta ? `（${meta}）` : ''}：${text}`
    })
    .join('\n')
}

const renderDocxRevisions = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `- ${renderKeyValuePairs([
        ['revisionRef', readStringField(item, 'revisionRef')],
        ['docId', readStringField(item, 'docId')],
        ['parentRevisionRef', readStringField(item, 'parentRevisionRef')],
        ['summary', readStringField(item, 'summary')]
      ])}`
    })
    .join('\n')
}

const renderDocxReadResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['currentRevisionRef', readStringField(obj, 'currentRevisionRef')],
      ['fromBlockIndex', readNumberTextField(obj, 'fromBlockIndex')],
      ['toBlockIndex', readNumberTextField(obj, 'toBlockIndex')]
    ]),
    'blocks:',
    renderDocxBlocks(obj.blocks)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxSearchResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['currentRevisionRef', readStringField(obj, 'currentRevisionRef')],
      ['mode', readStringField(obj, 'mode')],
      ['effectiveQuery', readStringField(obj, 'effectiveQuery')],
      ['returnedMatchCount', readNumberTextField(obj, 'returnedMatchCount')],
      ['totalMatchCount', readNumberTextField(obj, 'totalMatchCount')]
    ]),
    'matches:',
    renderDocxSearchMatches(obj.matches)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxOutlineResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['currentRevisionRef', readStringField(obj, 'currentRevisionRef')]
    ]),
    'blocks:',
    renderDocxBlocks(obj.blocks)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxHistoryResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['currentRevisionRef', readStringField(obj, 'currentRevisionRef')]
    ]),
    'revisions:',
    renderDocxRevisions(obj.revisions)
  ]
    .filter(Boolean)
    .join('\n')

const renderWebCrawlLinks = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `${index + 1}. ${renderKeyValuePairs([
        ['href', readStringField(item, 'href')],
        ['text', readStringField(item, 'text')]
      ])}`
    })
    .join('\n')
}

const renderWebCrawlResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['finalUrl', readStringField(obj, 'finalUrl')],
      ['title', readStringField(obj, 'title')],
      ['publishedAt', readStringField(obj, 'publishedAt')]
    ]),
    'selected page content:',
    'markdown:',
    readStringField(obj, 'markdown') || 'none',
    'links:',
    renderWebCrawlLinks(obj.links)
  ]
    .filter(Boolean)
    .join('\n')

const renderWebSearchResults = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `${index + 1}. ${renderKeyValuePairs([
        ['rank', readNumberTextField(item, 'rank')],
        ['title', readStringField(item, 'title')],
        ['url', readStringField(item, 'url')],
        ['snippet', readStringField(item, 'snippet')]
      ])}`
    })
    .join('\n')
}

const renderWebSearchResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([['query', readStringField(obj, 'query')]]),
    'results:',
    renderWebSearchResults(obj.results)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxCreateResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['warnings', Array.isArray(obj.warnings) && obj.warnings.length > 0 ? String(obj.warnings.length) : undefined]
    ]),
    'postWriteReadback:',
    renderDocxPostWriteReadback(obj.postWriteReadback)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxPostWriteReadback = (value: JsonValue | undefined): string => {
  if (!isJsonObject(value) || !Array.isArray(value.regions) || value.regions.length === 0) {
    return 'none'
  }

  return value.regions
    .map((region, index) => {
      if (!isJsonObject(region)) return renderGenericArrayItem(region, index)
      const header = `region ${index + 1}：${renderKeyValuePairs([
        ['fromBlockIndex', readNumberTextField(region, 'fromBlockIndex')],
        ['toBlockIndex', readNumberTextField(region, 'toBlockIndex')]
      ])}`
      return `${header}\nblocks:\n${renderDocxBlocks(region.blocks)}`
    })
    .join('\n')
}

export const renderToolResourceContextText = (
  resourceContext: ToolResourceContext | undefined
): string | undefined => {
  if (!resourceContext) return undefined

  return renderKeyValuePairs([
    ['family', resourceContext.family],
    ['effectKind', resourceContext.effectKind],
    ['sourcePath', resourceContext.sourcePath],
    ['previousRevisionRef', resourceContext.previousRevisionRef],
    ['currentRevisionRef', resourceContext.currentRevisionRef]
  ])
}

export const renderToolResultDataText = (
  result: Pick<ToolCallResult, 'toolName' | 'data'>
): string | undefined => {
  const value = result.data
  const primitive = renderPrimitive(value)
  if (primitive) return primitive

  if (Array.isArray(value)) return renderGenericArray(value)
  if (!isJsonObject(value)) return undefined

  switch (result.toolName) {
    case 'docx_edit':
      return renderDocxCreateResult(value)
    case 'docx_read_blocks':
      return renderDocxReadResult(value)
    case 'docx_search':
      return renderDocxSearchResult(value)
    case 'docx_outline':
      return renderDocxOutlineResult(value)
    case 'docx_history':
      return renderDocxHistoryResult(value)
    case 'web_search':
      return renderWebSearchResult(value)
    case 'web_crawl':
      return renderWebCrawlResult(value)
    default:
      return renderGenericObject(value)
  }
}

export const renderToolDiagnosticText = (result: ToolCallResult): string => {
  if (!result.diagnostic) return ''
  return `；diagnostic=${result.diagnostic.message.trim()}`
}

export const buildToolCallDisplayText = (
  result: Pick<ToolCallResult, 'toolName' | 'ok'>
): string => `调用工具 ${result.toolName}（${result.ok ? '成功' : '失败'}）`

export const resolveToolResultErrorText = (
  result: Pick<ToolCallResult, 'data'> & { diagnostic?: ToolCallResult['diagnostic'] }
): string => {
  if (result.diagnostic?.message.trim()) {
    return result.diagnostic.message.trim()
  }

  if (isJsonObject(result.data)) {
    const explicit =
      readStringField(result.data, 'error')
      || readStringField(result.data, 'message')
      || readStringField(result.data, 'stdout')
      || readStringField(result.data, 'stderr')
    if (explicit) return explicit
  }

  if (typeof result.data === 'string' && result.data.trim()) {
    return result.data.trim()
  }

  return 'tool call failed'
}

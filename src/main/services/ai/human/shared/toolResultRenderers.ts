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
      readStringField(value, 'blockId') ||
      readStringField(value, 'document_name') ||
      readStringField(value, 'name') ||
      readStringField(value, 'id') ||
      readStringField(value, 'docId')
    const text =
      readStringField(value, 'text') ||
      readStringField(value, 'preview') ||
      readStringField(value, 'summary') ||
      readStringField(value, 'message') ||
      readStringField(value, 'error') ||
      readStringField(value, 'output') ||
      readStringField(value, 'stdout') ||
      readStringField(value, 'stderr') ||
      readStringField(value, 'beforeText') ||
      readStringField(value, 'afterText')

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

const renderDocxBlockLine = (value: JsonValue, index: number, depth = 0): string => {
  if (!isJsonObject(value)) return renderGenericArrayItem(value, index)

  const nodeId =
    readStringField(value, 'blockId') ||
    readStringField(value, 'nodeId') ||
    readStringField(value, 'visualId') ||
    `item-${index + 1}`
  const type = readStringField(value, 'type')
  const blockIndex = readNumberField(value, 'blockIndex')
  const visuals = isJsonObject(value.visuals) ? value.visuals : undefined
  const visualKinds =
    visuals && Array.isArray(visuals.kinds)
      ? visuals.kinds.filter((kind): kind is string => typeof kind === 'string').join(',')
      : undefined
  const text =
    readStringField(value, 'text') ||
    readStringField(value, 'summary') ||
    readStringField(value, 'message') ||
    ''
  const extra =
    renderKeyValuePairs([
      ['type', type],
      ['blockIndex', typeof blockIndex === 'number' ? String(blockIndex) : undefined],
      ['tableBlockId', readStringField(value, 'tableBlockId')],
      ['row', readNumberTextField(value, 'row')],
      ['col', readNumberTextField(value, 'col')],
      ['rows', readNumberTextField(value, 'rows')],
      ['cols', readNumberTextField(value, 'cols')],
      ['visualCount', visuals ? readNumberTextField(visuals, 'count') : undefined],
      ['visualKinds', visualKinds]
    ]) || undefined

  const indent = '  '.repeat(depth)
  const baseLine = `${indent}- ${nodeId}${extra ? `（${extra}）` : ''}：${text || readStringField(value, 'kind') || ''}`
  if (!Array.isArray(value.children) || value.children.length === 0) return baseLine
  return `${baseLine}\n${value.children.map((child, childIndex) => renderDocxBlockLine(child, childIndex, depth + 1)).join('\n')}`
}

const renderDocxBlocks = (value: JsonValue | undefined): string =>
  Array.isArray(value) && value.length > 0
    ? value.map((block, index) => renderDocxBlockLine(block, index)).join('\n')
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

const renderDocxReadResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([['sourcePath', readStringField(obj, 'sourcePath')]]),
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
      ['totalBlockCount', readNumberTextField(obj, 'totalBlockCount')]
    ]),
    'blocks:',
    renderDocxBlocks(obj.blocks)
  ]
    .filter(Boolean)
    .join('\n')

const renderPdfPageList = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'
  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return [
        `page ${readNumberTextField(item, 'pageNumber') || String(index + 1)}：${renderKeyValuePairs(
          [
            ['textStatus', readStringField(item, 'textStatus')],
            ['charCount', readNumberTextField(item, 'charCount')],
            ['imageCount', readNumberTextField(item, 'imageCount')]
          ]
        )}`,
        readStringField(item, 'text') || '(no text)'
      ].join('\n')
    })
    .join('\n\n')
}

const renderPdfSearchMatches = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'
  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `${index + 1}. ${renderKeyValuePairs([
        ['pageNumber', readNumberTextField(item, 'pageNumber')],
        ['matchedText', readStringField(item, 'matchedText')],
        ['snippet', readStringField(item, 'snippet')]
      ])}`
    })
    .join('\n')
}

const renderVisualResults = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'
  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `${index + 1}. ${renderKeyValuePairs([
        ['visualId', readStringField(item, 'visualId')],
        ['index', readNumberTextField(item, 'index')],
        ['text', readStringField(item, 'text')],
        ['error', readStringField(item, 'error')]
      ])}`
    })
    .join('\n')
}

const renderPdfInspectResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['pageCount', readNumberTextField(obj, 'pageCount')],
      ['encrypted', renderPrimitive(obj.encrypted)]
    ]),
    'metadata:',
    isJsonObject(obj.metadata) ? renderGenericObject(obj.metadata) : 'none',
    'outline:',
    Array.isArray(obj.outline) ? renderGenericArray(obj.outline) : 'none'
  ].join('\n')

const renderPdfSearchResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['pageCount', readNumberTextField(obj, 'pageCount')],
      ['query', readStringField(obj, 'query')],
      ['mode', readStringField(obj, 'mode')],
      ['returnedMatchCount', readNumberTextField(obj, 'returnedMatchCount')],
      ['totalMatchCount', readNumberTextField(obj, 'totalMatchCount')]
    ]),
    'matches:',
    renderPdfSearchMatches(obj.matches)
  ].join('\n')

const renderPdfReadPagesResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['sourcePath', readStringField(obj, 'sourcePath')],
      ['pageCount', readNumberTextField(obj, 'pageCount')]
    ]),
    'pages:',
    renderPdfPageList(obj.pages)
  ].join('\n')

const renderVisualReadResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([['sourcePath', readStringField(obj, 'sourcePath')]]),
    'results:',
    renderVisualResults(obj.results)
  ].join('\n')

const renderWebSearchLinkList = (value: JsonValue | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return 'none'

  return value
    .map((item, index) => {
      if (!isJsonObject(item)) return renderGenericArrayItem(item, index)
      return `${index + 1}. ${renderKeyValuePairs([
        ['href', readStringField(item, 'href')],
        ['text', readStringField(item, 'text')],
        ['title', readStringField(item, 'title')],
        ['intrinsicScore', readNumberTextField(item, 'intrinsicScore')],
        ['contextualScore', readNumberTextField(item, 'contextualScore')],
        ['totalScore', readNumberTextField(item, 'totalScore')]
      ])}`
    })
    .join('\n')
}

const renderWebSearchLinks = (value: JsonValue | undefined): string => {
  if (!isJsonObject(value)) return 'none'

  return [
    'internal:',
    renderWebSearchLinkList(value.internal),
    'external:',
    renderWebSearchLinkList(value.external)
  ].join('\n')
}

const renderWebSearchResult = (obj: JsonObject): string =>
  [
    renderKeyValuePairs([
      ['requestedUrl', readStringField(obj, 'requestedUrl')],
      ['finalUrl', readStringField(obj, 'finalUrl')],
      ['title', readStringField(obj, 'title')],
      ['publishedAt', readStringField(obj, 'publishedAt')]
    ]),
    'selected page content:',
    'markdown:',
    readStringField(obj, 'markdown') || 'none',
    'links:',
    renderWebSearchLinks(obj.links)
  ]
    .filter(Boolean)
    .join('\n')

const renderDocxCreateResult = (obj: JsonObject): string => [
  renderKeyValuePairs([
    ['msg', readStringField(obj, 'msg')],
    ['sourcePath', readStringField(obj, 'sourcePath')]
  ]),
  'createdBlockIds:',
  renderGenericArray(Array.isArray(obj.createdBlockIds) ? obj.createdBlockIds : [])
]
  .filter(Boolean)
  .join('\n')

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
    case 'docx_read_outline':
      return renderDocxOutlineResult(value)
    case 'pdf_inspect':
      return renderPdfInspectResult(value)
    case 'pdf_search':
      return renderPdfSearchResult(value)
    case 'pdf_read_pages':
      return renderPdfReadPagesResult(value)
    case 'pdf_read_visuals':
    case 'ppt_read_visuals':
    case 'docx_read_visuals':
      return renderVisualReadResult(value)
    case 'web_search':
      return renderWebSearchResult(value)
    default:
      return renderGenericObject(value)
  }
}

export const buildToolCallDisplayText = (result: Pick<ToolCallResult, 'toolName' | 'ok'>): string =>
  `调用工具 ${result.toolName}（${result.ok ? '成功' : '失败'}）`

export const resolveToolResultErrorText = (result: Pick<ToolCallResult, 'data'>): string => {
  if (isJsonObject(result.data)) {
    const explicit =
      readStringField(result.data, 'error') ||
      readStringField(result.data, 'message') ||
      readStringField(result.data, 'output') ||
      readStringField(result.data, 'stdout') ||
      readStringField(result.data, 'stderr')
    if (explicit) return explicit
  }

  if (typeof result.data === 'string' && result.data.trim()) {
    return result.data.trim()
  }

  return 'tool call failed'
}

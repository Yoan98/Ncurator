import path from 'node:path'
import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { ModelResultRenderer, ModelResultRendererInput } from '../tools/types'

const MODEL_TEXT_LINE_CHARS = 1_600

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const readString = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

const readNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const wrapPhysicalLine = (value: string): string[] => {
  const characters = Array.from(value)
  if (characters.length <= MODEL_TEXT_LINE_CHARS) return [value]
  const lines: string[] = []
  for (let offset = 0; offset < characters.length; offset += MODEL_TEXT_LINE_CHARS) {
    lines.push(characters.slice(offset, offset + MODEL_TEXT_LINE_CHARS).join(''))
  }
  return lines
}

export const wrapModelTextLines = (value: string): string =>
  value
    .split(/\r\n|\r|\n/u)
    .flatMap(wrapPhysicalLine)
    .join('\n')

const indentBlock = (value: string, depth: number): string => {
  const indent = '  '.repeat(depth)
  return wrapModelTextLines(value)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

const renderPrimitive = (value: JsonValue, depth: number): string => {
  if (typeof value !== 'string') return String(value)
  if (!value.includes('\n') && Array.from(value).length <= 160) return JSON.stringify(value)
  return `|\n${indentBlock(value, depth + 1)}`
}

const renderTreeValue = (value: JsonValue, depth: number): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((item) => {
        const rendered = renderTreeValue(item, depth + 1)
        return rendered.includes('\n')
          ? `${'  '.repeat(depth)}-\n${indentBlock(rendered, 1)}`
          : `${'  '.repeat(depth)}- ${rendered}`
      })
      .join('\n')
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    return entries
      .map(([key, item]) => {
        const rendered = renderTreeValue(item, depth + 1)
        return rendered.includes('\n')
          ? `${'  '.repeat(depth)}${key}:\n${indentBlock(rendered, 1)}`
          : `${'  '.repeat(depth)}${key}: ${rendered}`
      })
      .join('\n')
  }
  return renderPrimitive(value, depth)
}

export const renderGenericModelResult: ModelResultRenderer = ({ toolName, data }) => {
  if (data === undefined) return `${toolName} completed successfully.`
  return wrapModelTextLines(
    [`${toolName} completed successfully.`, 'Result:', renderTreeValue(data, 0)].join('\n')
  )
}

const containsOnlyModelSafeDiagnosticText = (value: string): boolean =>
  /^[\x20-\x7E\r\n\t]+$/u.test(value)

export const renderGenericModelError: ModelResultRenderer = ({ toolName, data }) => {
  const detail = isObject(data)
    ? readString(data.error) || readString(data.message)
    : readString(data)
  if (detail && containsOnlyModelSafeDiagnosticText(detail)) return `Error: ${detail}`
  return `Error: ${toolName} failed. Check the tool arguments and try again.`
}

const normalizeKbSearchItems = (data: JsonValue | undefined): JsonObject[] => {
  if (!isObject(data) || !Array.isArray(data.items)) return []
  return data.items.filter(isObject)
}

export const renderKbSearchModelResult: ModelResultRenderer = ({ data }) => {
  const items = normalizeKbSearchItems(data)
  const sourceKeys = new Map<string, string>()
  const sources: Array<{ ref: string; item: JsonObject }> = []
  items.forEach((item) => {
    const key =
      readString(item.documentId) ||
      `${readString(item.documentName) || ''}\u0000${readString(item.filePath) || readString(item.sourceUrl) || ''}`
    if (sourceKeys.has(key)) return
    const ref = `d${sources.length + 1}`
    sourceKeys.set(key, ref)
    sources.push({ ref, item })
  })

  const sourceLines = sources.length
    ? sources.map(({ ref, item }) => {
        const fields = [
          `[${ref}] name=${readString(item.documentName) || ''}`,
          readString(item.documentId) ? `documentId=${readString(item.documentId)}` : '',
          readString(item.sourceType) ? `type=${readString(item.sourceType)}` : '',
          readString(item.filePath)
            ? `path=${readString(item.filePath)}`
            : readString(item.sourceUrl)
              ? `url=${readString(item.sourceUrl)}`
              : ''
        ].filter(Boolean)
        return `  ${fields.join('; ')}`
      })
    : ['  none']

  const matchLines = items.length
    ? items.flatMap((item, index) => {
        const key =
          readString(item.documentId) ||
          `${readString(item.documentName) || ''}\u0000${readString(item.filePath) || readString(item.sourceUrl) || ''}`
        const ref = sourceKeys.get(key) || 'unknown'
        return [
          `  ${index + 1}. source=${ref}`,
          '     content:',
          indentBlock(readString(item.text) || '', 3)
        ]
      })
    : ['  none']

  return [
    'KB search completed successfully.',
    `Returned matches: ${items.length}`,
    'Sources:',
    ...sourceLines,
    'Matches:',
    ...matchLines
  ].join('\n')
}

export const renderKbListDocumentsModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const items = Array.isArray(obj.items) ? obj.items.filter(isObject) : []
  return [
    'KB document listing completed successfully.',
    `Total documents: ${readNumber(obj.total) ?? items.length}`,
    'Documents:',
    ...(items.length
      ? items.map((item, index) =>
          `  ${index + 1}. id=${readString(item.id) || ''}; name=${readString(item.name) || ''}; type=${readString(item.sourceType) || ''}; ${
            readString(item.filePath)
              ? `path=${readString(item.filePath)}`
              : readString(item.sourceUrl)
                ? `url=${readString(item.sourceUrl)}`
                : ''
          }`.trimEnd()
        )
      : ['  none'])
  ].join('\n')
}

export const renderDocxOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const segments = Array.isArray(obj.segments) ? obj.segments.filter(isObject) : []
  return [
    'DOCX outline read completed successfully.',
    `Range: ${readNumber(obj.fromPercent) ?? ''}-${readNumber(obj.toPercent) ?? ''}%; nodeIndex=${readNumber(obj.fromNodeIndex) ?? ''}-${readNumber(obj.toNodeIndex) ?? ''}; totalRootCount=${readNumber(obj.totalRootCount) ?? ''}`,
    'Segments:',
    ...(segments.length
      ? segments.flatMap((segment, index) => [
          `  ${index + 1}. story=${readString(segment.story) || ''}; nodeIndex=${readNumber(segment.fromNodeIndex) ?? ''}-${readNumber(segment.toNodeIndex) ?? ''}`,
          indentBlock(readString(segment.textMap) || '', 2)
        ])
      : ['  none'])
  ].join('\n')
}

const renderDocxNeighbor = (value: JsonValue | undefined, label: string): string[] => {
  const items = Array.isArray(value) ? value.filter(isObject) : []
  if (!items.length) return []
  return [
    `    ${label}:`,
    ...items.flatMap((item) => [
      `      - nodeId=${readString(item.nodeId) || ''}; nodeIndex=${readNumber(item.nodeIndex) ?? ''}; type=${readString(item.type) || ''}`,
      indentBlock(readString(item.textPreview) || '', 4)
    ])
  ]
}

export const renderDocxSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return [
    'DOCX search completed successfully.',
    `Total matches: ${readNumber(obj.totalMatchCount) ?? 0}`,
    'Returned matches:',
    ...(matches.length
      ? matches.flatMap((item, index) => [
          `  ${index + 1}. nodeId=${readString(item.nodeId) || ''}; nodeIndex=${readNumber(item.nodeIndex) ?? ''}; type=${readString(item.type) || ''}; story=${readString(item.story) || ''}${readString(item.tableNodeId) ? `; tableNodeId=${readString(item.tableNodeId)}` : ''}`,
          `    matchText=${JSON.stringify(readString(item.matchText) || '')}`,
          '    context:',
          indentBlock(readString(item.textContext) || '', 3),
          ...renderDocxNeighbor(item.before, 'before'),
          ...renderDocxNeighbor(item.after, 'after')
        ])
      : ['  none'])
  ].join('\n')
}

type StyleCatalog = {
  ids: Map<string, string>
  values: Array<{ id: string; style: JsonObject }>
}

const stableJson = (value: JsonValue): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const buildDocxStyleCatalog = (value: JsonValue | undefined): StyleCatalog => {
  const catalog: StyleCatalog = { ids: new Map(), values: [] }
  const visit = (item: JsonValue | undefined): void => {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (!isObject(item)) return
    if (isObject(item.style)) {
      const key = stableJson(item.style)
      if (!catalog.ids.has(key)) {
        const id = `S${catalog.values.length + 1}`
        catalog.ids.set(key, id)
        catalog.values.push({ id, style: item.style })
      }
    }
    Object.values(item).forEach(visit)
  }
  visit(value)
  return catalog
}

const mergeAdjacentTextChildren = (items: JsonValue[]): JsonValue[] => {
  const merged: JsonValue[] = []
  for (const item of items) {
    const previous = merged.at(-1)
    if (
      isObject(previous) &&
      previous.type === 'text' &&
      isObject(item) &&
      item.type === 'text' &&
      typeof previous.text === 'string' &&
      typeof item.text === 'string'
    ) {
      previous.text += item.text
    } else if (isObject(item)) {
      merged.push({ ...item })
    } else {
      merged.push(item)
    }
  }
  return merged
}

const renderDocxNode = (value: JsonValue, depth: number, styles: StyleCatalog): string[] => {
  if (!isObject(value)) return [`${'  '.repeat(depth)}- ${renderTreeValue(value, depth)}`]
  const indent = '  '.repeat(depth)
  const fields = Object.entries(value).filter(([key]) => key !== 'children' && key !== 'style')
  const headerFields: string[] = []
  const blockFields: Array<[string, string]> = []
  fields.forEach(([key, item]) => {
    if (typeof item === 'string' && (item.includes('\n') || Array.from(item).length > 160)) {
      blockFields.push([key, item])
      return
    }
    if (Array.isArray(item) || isObject(item)) {
      blockFields.push([key, renderTreeValue(item, depth + 1)])
      return
    }
    headerFields.push(`${key}=${typeof item === 'string' ? JSON.stringify(item) : String(item)}`)
  })
  if (isObject(value.style)) {
    headerFields.push(`style=${styles.ids.get(stableJson(value.style)) || ''}`)
  }
  const lines = [`${indent}- ${headerFields.join('; ')}`]
  blockFields.forEach(([key, item]) => {
    lines.push(`${indent}  ${key}:`, indentBlock(item, depth + 2))
  })
  if (Array.isArray(value.children)) {
    lines.push(`${indent}  children:`)
    mergeAdjacentTextChildren(value.children).forEach((child) => {
      lines.push(...renderDocxNode(child, depth + 2, styles))
    })
  }
  return lines
}

export const renderDocxReadNodesModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const styles = buildDocxStyleCatalog(obj.nodes)
  const nodes = Array.isArray(obj.nodes) ? obj.nodes : []
  return [
    'DOCX nodes read completed successfully.',
    'Styles:',
    ...(styles.values.length
      ? styles.values.flatMap(({ id, style }) => [
          `  ${id}:`,
          indentBlock(renderTreeValue(style, 0), 2)
        ])
      : ['  none']),
    'Nodes:',
    ...(nodes.length ? nodes.flatMap((node) => renderDocxNode(node, 1, styles)) : ['  none'])
  ].join('\n')
}

export const renderDocxContentEditModelResult: ModelResultRenderer = ({ args, data }) => {
  const obj = isObject(data) ? data : {}
  const sourcePath = readString(args.sourcePath) || ''
  const createdIds = Array.isArray(obj.createdIds)
    ? obj.createdIds.filter((item): item is string => typeof item === 'string')
    : []
  return [
    `DOCX content edit completed successfully: ${path.basename(sourcePath)}`,
    createdIds.length ? `Created node IDs: ${createdIds.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export const renderDocxMutationModelResult: ModelResultRenderer = renderDocxContentEditModelResult

export const renderTextFileEditModelResult: ModelResultRenderer = () => 'Text file edit completed.'

export const renderTerminalModelResult: ModelResultRenderer = ({ toolName, data }) => {
  const obj = isObject(data) ? data : {}
  const status = readString(obj.status) || 'completed'
  const exitCode = obj.exitCode === null ? undefined : readNumber(obj.exitCode)
  const completion =
    status === 'completed'
      ? exitCode === undefined || exitCode === 0
        ? 'completed successfully'
        : 'completed'
      : status
  const lines = [
    toolName === 'terminal_run'
      ? `Terminal command ${completion}${exitCode !== undefined ? ` (exit code: ${exitCode})` : ''}.`
      : `Terminal output read ${status === 'completed' ? 'completed successfully' : status}.`,
    readString(obj.terminalId) ? `Terminal ID: ${readString(obj.terminalId)}` : '',
    readNumber(obj.readEndPosition) !== undefined
      ? `Read end position: ${readNumber(obj.readEndPosition)}`
      : '',
    typeof obj.hasMoreOutput === 'boolean' ? `Has more output: ${obj.hasMoreOutput}` : '',
    'Output:',
    readString(obj.output) || ''
  ]
  return lines.filter((line, index) => Boolean(line) || index === lines.length - 1).join('\n')
}

export const renderTextFileReadModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const content = readString(obj.content) || ''
  const endLine = readNumber(obj.endLine) ?? readNumber(obj.startLine) ?? 1
  const totalLines = readNumber(obj.totalLines) ?? endLine
  const nextLine = readNumber(obj.nextStartLine)
  const metadata = nextLine
    ? [`totalLines: ${totalLines}`, `nextStartLine: ${nextLine}`]
    : [`totalLines: ${totalLines}`]
  return ['<content>', content, '</content>', ...metadata].join('\n')
}

export const renderTextFileSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return [
    'Text search completed successfully.',
    `Total matches: ${readNumber(obj.totalMatchCount) ?? 0}`,
    'Returned matches:',
    ...(matches.length
      ? matches.flatMap((item, index) => [
          `  ${index + 1}. line=${readNumber(item.line) ?? ''}; match=${JSON.stringify(readString(item.matchText) || '')}; truncated=${String(item.truncated === true)}`,
          indentBlock(readString(item.textContext) || '', 2)
        ])
      : ['  none'])
  ].join('\n')
}

const formatExcelRangeCell = (value: JsonValue | undefined): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (!isObject(value)) return ''
  const formula = readString(value.formula)
  if (!formula) return ''
  const result = value.value
  const serialized =
    result === null || result === undefined
      ? undefined
      : typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean'
        ? String(result)
        : undefined
  return serialized ? `=${formula} => ${serialized}` : `=${formula}`
}

const columnLettersFromIndex = (column: number): string => {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

const parseExcelRange = (
  range: string
): { top: number; left: number; bottom: number; right: number } | undefined => {
  const match = range.trim().match(/^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/)
  if (!match) return undefined
  const left = match[1]
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
  const top = Number(match[2])
  const right = match[3]
    ? match[3]
        .toUpperCase()
        .split('')
        .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
    : left
  const bottom = match[4] ? Number(match[4]) : top
  if (bottom < top || right < left) return undefined
  return { top, left, bottom, right }
}

const formatExcelRangeMetadata = (range: string): string => {
  const parsed = parseExcelRange(range)
  if (!parsed) return range
  const startCol = columnLettersFromIndex(parsed.left)
  const endCol = columnLettersFromIndex(parsed.right)
  const rangeLabel =
    parsed.top === parsed.bottom && parsed.left === parsed.right
      ? `${startCol}${parsed.top}`
      : `${startCol}${parsed.top}:${endCol}${parsed.bottom}`
  const columnPart =
    parsed.left === parsed.right ? `column ${startCol}` : `columns ${startCol}–${endCol}`
  const rowPart =
    parsed.top === parsed.bottom ? `row ${parsed.top}` : `rows ${parsed.top}–${parsed.bottom}`
  return `${rangeLabel} (${columnPart}, ${rowPart})`
}

const formatExcelStyleField = (value: JsonValue | undefined): string => {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

export const renderExcelReadModelResult: ModelResultRenderer = ({ args, data }) => {
  const obj = isObject(data) ? data : {}
  const type = typeof args.type === 'string' ? args.type : undefined
  if (type === 'workbook' || Array.isArray(obj.sheets)) {
    const sheets = Array.isArray(obj.sheets) ? obj.sheets.filter(isObject) : []
    return [
      'Excel workbook read completed.',
      'Sheets:',
      ...(sheets.length
        ? sheets.map((sheet, index) => {
            const range = readString(sheet.range) || 'empty'
            return `  ${index + 1}. ${readString(sheet.name) || ''}  ${range}  rows=${readNumber(sheet.rowCount) ?? 0} cols=${readNumber(sheet.columnCount) ?? 0}`
          })
        : ['  none'])
    ].join('\n')
  }
  if (type === 'search' || Array.isArray(obj.matches)) {
    const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
    return [
      'Excel search completed.',
      `truncated: ${String(obj.truncated === true)}`,
      'Matches:',
      ...(matches.length
        ? matches.map((item) => {
            const formula = readString(item.formula)
            const value =
              typeof item.value === 'string' ||
              typeof item.value === 'number' ||
              typeof item.value === 'boolean'
                ? String(item.value)
                : item.value === null
                  ? ''
                  : ''
            const sheet = readString(item.sheetName) || ''
            const cell = readString(item.address) || ''
            const detail = formula ? `formula=${formula}` : `value=${value}`
            return `  sheet=${sheet} cell=${cell} ${detail}`.trimEnd()
          })
        : ['  none'])
    ].join('\n')
  }
  const sheetName = readString(obj.sheetName) || ''
  const range = readString(obj.range) || ''
  const rows = Array.isArray(obj.rows) ? obj.rows : []
  const origin = parseExcelRange(range)
  const rangeMetadata = formatExcelRangeMetadata(range)
  if (type === 'style') {
    const styleRows: string[] = []
    rows.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || !origin) return
      row.forEach((cell, columnIndex) => {
        if (!isObject(cell)) return
        const hasStyle =
          cell.bold === true ||
          typeof cell.fontColor === 'string' ||
          typeof cell.fillColor === 'string' ||
          typeof cell.numberFormat === 'string'
        if (!hasStyle) return
        const address = `${columnLettersFromIndex(origin.left + columnIndex)}${origin.top + rowIndex}`
        styleRows.push(
          `| ${address} | ${formatExcelStyleField(cell.bold)} | ${formatExcelStyleField(cell.fontColor)} | ${formatExcelStyleField(cell.fillColor)} | ${formatExcelStyleField(cell.numberFormat)} |`
        )
      })
    })
    return [
      'Excel style read completed.',
      `Sheet: ${sheetName}`,
      `Range: ${rangeMetadata}`,
      '| Cell | bold | fontColor | fillColor | numberFormat |',
      '| --- | --- | --- | --- | --- |',
      ...(styleRows.length ? styleRows : ['| none | | | | |'])
    ].join('\n')
  }
  return [
    'Excel range read completed.',
    `Sheet: ${sheetName}`,
    `Range: ${rangeMetadata}`,
    ...(rows.length
      ? rows.map((row, rowIndex) => {
          if (!Array.isArray(row)) return ''
          const rowNumber = origin ? origin.top + rowIndex : rowIndex + 1
          return `| ${rowNumber} | ${row.map((cell) => formatExcelRangeCell(cell)).join(' | ')} |`
        })
      : ['  none'])
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export const renderExcelEditModelResult: ModelResultRenderer = ({ args }) => {
  const type = typeof args.type === 'string' ? args.type : 'edit'
  return `Excel ${type} completed.`
}

export const renderPdfOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const metadata = isObject(obj.metadata) ? obj.metadata : {}
  const outline = Array.isArray(obj.outline) ? obj.outline.filter(isObject) : []
  return [
    'PDF outline read completed.',
    `Pages: ${readNumber(obj.pageCount) ?? 0}`,
    readString(metadata.title) ? `Title: ${readString(metadata.title)}` : '',
    readString(metadata.author) ? `Author: ${readString(metadata.author)}` : '',
    'Outline:',
    ...(outline.length
      ? outline.map((item, index) => {
          const depth = readNumber(item.depth) ?? 1
          const indent = '  '.repeat(Math.max(0, depth - 1))
          const page = readNumber(item.pageNumber)
          return `${indent}${index + 1}. ${readString(item.title) || ''}${page ? ` (p.${page})` : ''}`
        })
      : ['  none'])
  ]
    .filter(Boolean)
    .join('\n')
}

export const renderPdfSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return [
    'PDF search completed.',
    `Total matches: ${readNumber(obj.totalMatchCount) ?? 0}`,
    `Returned matches: ${readNumber(obj.returnedMatchCount) ?? matches.length}`,
    'Matches:',
    ...(matches.length
      ? matches.map((item, index) => {
          const pageNumber = readNumber(item.pageNumber) ?? ''
          const matchedText = readString(item.matchedText) || ''
          const snippet = readString(item.snippet) || ''
          return [
            `  ${index + 1}. p.${pageNumber}: matched=${JSON.stringify(matchedText)}`,
            indentBlock(snippet, 2)
          ].join('\n')
        })
      : ['  none'])
  ].join('\n')
}

export const renderPdfReadPagesModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const pages = Array.isArray(obj.pages) ? obj.pages.filter(isObject) : []
  return [
    'PDF pages read completed.',
    'Pages:',
    ...(pages.length
      ? pages.flatMap((page) => {
          const pageNumber = readNumber(page.pageNumber) ?? ''
          const textStatus = readString(page.textStatus) || ''
          const imageCount = readNumber(page.imageCount) ?? 0
          const pageImagePath = readString(page.pageImagePath) || ''
          const text = readString(page.text) || ''
          const lines = [
            `  p.${pageNumber} [${textStatus}, ${imageCount} images]`,
            `    pageImagePath: ${pageImagePath}`
          ]
          if (text) lines.push(indentBlock(text, 2))
          else if (textStatus === 'empty') lines.push('    (no text layer)')
          return lines
        })
      : ['  none'])
  ].join('\n')
}

export const renderWebSearchModelResult: ModelResultRenderer = ({ args, data }) => {
  const obj = isObject(data) ? data : {}
  const items = Array.isArray(obj.items) ? obj.items.filter(isObject) : []
  const query = readString(args.query)
  const url = readString(args.url)
  const header = query
    ? `Web search completed. Query: ${query}`
    : url
      ? `Web page fetched. URL: ${url}`
      : 'Web search completed.'
  return [
    header,
    `Results: ${items.length}`,
    ...(items.length
      ? items.map((item, index) => {
          const error = readString(item.error)
          const title = readString(item.title) || readString(item.requestedUrl) || ''
          const requestedUrl = readString(item.requestedUrl) || ''
          if (error) return `  ${index + 1}. [error] ${title} — ${error}`
          const markdown = readString(item.markdown) || ''
          if (url && markdown) {
            return [`  ${index + 1}. ${title}`, indentBlock(markdown, 2)].join('\n')
          }
          return `  ${index + 1}. ${title}\n     url: ${requestedUrl}`
        })
      : ['  none'])
  ].join('\n')
}

export const renderBrowserUseModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const error = readString(obj.error)
  if (error) return `Browser action failed: ${error}`
  const action = readString(obj.action) || ''
  const page = isObject(obj.page) ? obj.page : {}
  const pageLabel = [readString(page.title), readString(page.url)].filter(Boolean).join(' — ')
  if (action === 'navigate') {
    return ['Browser navigate completed.', pageLabel ? `Page: ${pageLabel}` : ''].filter(Boolean).join('\n')
  }
  if (action === 'extract') {
    const content = readString(obj.content) || ''
    return [
      'Browser extract completed.',
      pageLabel ? `Page: ${pageLabel}` : '',
      'Content:',
      content ? indentBlock(content, 0) : '  (empty)'
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (action === 'observe') {
    const actions = Array.isArray(obj.actions) ? obj.actions.filter(isObject) : []
    return [
      'Browser observe completed.',
      pageLabel ? `Page: ${pageLabel}` : '',
      'Actions:',
      ...(actions.length
        ? actions.map((item, index) => `  ${index + 1}. ${readString(item.description) || ''}`)
        : ['  none'])
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (action === 'act') {
    return [
      'Browser act completed.',
      pageLabel ? `Page: ${pageLabel}` : '',
      `Success: ${String(obj.success === true)}`,
      readString(obj.message) ? `Message: ${readString(obj.message)}` : '',
      readString(obj.actionDescription)
        ? `Action: ${readString(obj.actionDescription)}`
        : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    'Browser action completed.',
    action ? `Action: ${action}` : '',
    pageLabel ? `Page: ${pageLabel}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export const renderPlanUpdateModelResult: ModelResultRenderer = () => 'Plan updated successfully.'

export const renderPptOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const slides = Array.isArray(obj.slides) ? obj.slides.filter(isObject) : []
  return [
    'PPT outline read completed successfully.',
    `Slide count: ${readNumber(obj.slideCount) ?? slides.length}`,
    'Slides:',
    ...(slides.length
      ? slides.map((slide, index) => {
          const slideId = readString(slide.slideId) || ''
          const slideIndex = readNumber(slide.slideIndex) ?? index + 1
          const title = readString(slide.title) || ''
          return `  ${index + 1}. slideIndex=${slideIndex}; slideId=${slideId}${title ? `; title=${JSON.stringify(title)}` : ''}`
        })
      : ['  none'])
  ].join('\n')
}

export const renderPptReadSlidesModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const slides = Array.isArray(obj.slides) ? obj.slides.filter(isObject) : []
  return [
    'PPT slides read completed successfully.',
    `Returned slides: ${slides.length}`,
    ...(slides.length
      ? slides.flatMap((slide, index) => {
          const slideId = readString(slide.slideId) || ''
          const slideIndex = readNumber(slide.slideIndex) ?? index + 1
          const slideImagePath = readString(slide.slideImagePath) || ''
          const lines = [
            `  ${index + 1}. slideIndex=${slideIndex}; slideId=${slideId}`,
            slideImagePath ? `     slideImagePath: ${slideImagePath}` : ''
          ]
          const elements = Array.isArray(slide.elements) ? slide.elements.filter(isObject) : []
          if (elements.length) {
            lines.push('     elements:')
            elements.forEach((element, elementIndex) => {
              lines.push(
                `       ${elementIndex + 1}. type=${readString(element.type) || ''}; elementId=${readString(element.elementId) || ''}`
              )
            })
          }
          return lines.filter(Boolean)
        })
      : ['  none'])
  ].join('\n')
}

export const renderPptSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return [
    'PPT search completed successfully.',
    `Total matches: ${readNumber(obj.totalMatchCount) ?? 0}`,
    `Returned matches: ${readNumber(obj.returnedMatchCount) ?? matches.length}`,
    ...(obj.truncated === true ? ['(truncated)'] : []),
    'Matches:',
    ...(matches.length
      ? matches.map((item, index) => {
          const slideIndex = readNumber(item.slideIndex) ?? ''
          const slideId = readString(item.slideId) || ''
          const source = readString(item.source) || ''
          const text = readString(item.text) || ''
          return [
            `  ${index + 1}. slideIndex=${slideIndex}; slideId=${slideId}; source=${source}; matchedText=${JSON.stringify(readString(item.matchedText) || '')}`,
            indentBlock(text, 2)
          ].join('\n')
        })
      : ['  none'])
  ].join('\n')
}

export const renderPptEditModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const slideId = readString(obj.slideId)
  const createdElementIds = Array.isArray(obj.createdElementIds)
    ? obj.createdElementIds.filter((item): item is string => typeof item === 'string')
    : []
  return [
    'PPT edit completed.',
    slideId ? `slideId: ${slideId}` : '',
    createdElementIds.length ? `createdElementIds: ${createdElementIds.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export const renderImageGenerateModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const error = readString(obj.error)
  if (error) return `Image generation failed: ${error}`
  const outputPath = readString(obj.outputPath)
  return outputPath ? `Image saved: ${outputPath}` : 'Image generation completed.'
}

export const renderReadImageModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const images = Array.isArray(obj.images) ? obj.images.filter(isObject) : []
  if (images.length === 0) return 'No images loaded.'
  return [
    `${images.length} image${images.length === 1 ? '' : 's'} loaded:`,
    ...images.map((image, index) => {
      const imagePath = readString(image.path) || ''
      const width = readNumber(image.width) ?? ''
      const height = readNumber(image.height) ?? ''
      const mimeType = readString(image.mimeType) || ''
      const sizeLabel = width && height ? `${width}x${height}` : ''
      const meta = [sizeLabel, mimeType.replace(/^image\//u, '')].filter(Boolean).join(' ')
      return `  ${index + 1}. ${imagePath}${meta ? ` ${meta}` : ''}`
    })
  ].join('\n')
}

export const renderLearnSkillModelResult: ModelResultRenderer = ({ args }) => {
  const requested = Array.isArray(args.skillIds)
    ? args.skillIds.filter((item): item is string => typeof item === 'string')
    : []
  return `Skill loaded successfully: ${requested.join(', ') || 'requested skill'}.`
}

export const renderModelResultWith = (
  renderer: ModelResultRenderer | undefined,
  input: ModelResultRendererInput
): string => wrapModelTextLines((renderer || renderGenericModelResult)(input))

import type { JsonObject, JsonValue } from '../../../../../shared/types'
import type { ModelResultRenderer, ModelResultRendererInput } from '../tools/types'
import {
  formatReadRangeFooter,
  renderFileEnvelope,
  renderNumberedFileLines
} from './renderFamilies/envelope'
import { joinGroupedSections, renderGroupedHeader } from './renderFamilies/grouped'
import { renderUntrustedWebContent } from './renderFamilies/markdownWeb'
import {
  renderFileMutationProse,
  renderPlainConfirmation,
  renderProse
} from './renderFamilies/prose'
import { formatTerminalMarker, renderTerminalStream } from './renderFamilies/terminal'
import {
  indentBlock,
  isObject,
  readNumber,
  readString,
  wrapModelTextLines
} from './renderFamilies/shared'

export const renderGenericModelResult: ModelResultRenderer = ({ toolName }) =>
  wrapModelTextLines(`${toolName} completed successfully.`)

export const renderAskUserQuestionModelResult: ModelResultRenderer = ({ data }) => {
  const answers = isObject(data) && Array.isArray(data.answers) ? data.answers.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('The user replied to the questions or collaboration request.'),
    ...answers.map((answer) => {
      const selectedOptionIds = Array.isArray(answer.selectedOptionIds)
        ? answer.selectedOptionIds.filter((value): value is string => typeof value === 'string')
        : []
      const userText = readString(answer.userText)
      return `  questionId=${readString(answer.questionId) || ''}; selectedOptionIds=${JSON.stringify(selectedOptionIds)}${userText ? `; userText=${JSON.stringify(userText)}` : ''}`
    })
  ])
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

const readBoolean = (value: JsonValue | undefined): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

export const renderScheduledTaskListModelResult: ModelResultRenderer = ({ data }) => {
  const tasks = isObject(data) && Array.isArray(data.tasks) ? data.tasks.filter(isObject) : []
  if (tasks.length === 0) return '当前伙伴没有定时任务。'
  const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const lines = tasks.map((task, index) => {
    const scheduleType = readString(task.scheduleType) === 'weekly' ? '每周' : '每天'
    const weekday = readNumber(task.weekday)
    const schedule =
      scheduleType === '每周' && weekday !== undefined
        ? `每周 ${weekdayLabels[weekday] || String(weekday)} ${readString(task.timeOfDay) || ''}`
        : `每天 ${readString(task.timeOfDay) || ''}`
    const state = readBoolean(task.enabled) === true ? '已启用' : '已停用'
    const description = (readString(task.description) || '').replace(/\r?\n/gu, '\n   ')
    return `${index + 1}. ${readString(task.name) || ''}｜${schedule}｜${state}｜id=${readString(task.id) || ''}\n   描述：${description}`
  })
  return ['当前伙伴的定时任务：', ...lines].join('\n')
}

export const renderScheduledTaskMutationModelResult: ModelResultRenderer = ({ args, data }) => {
  const id = isObject(data) ? readString(data.id) : undefined
  const action = readString(args.action)
  const verb = action === 'create' ? '创建' : action === 'update' ? '更新' : '删除'
  return `已${verb}定时任务${id ? `，id=${id}` : ''}。`
}

export const renderScheduledTaskModelError: ModelResultRenderer = ({ toolName, data }) => {
  const detail = isObject(data) ? readString(data.error) || readString(data.message) : undefined
  return detail ? `Error: ${detail}` : `Error: ${toolName} 执行失败。`
}

const buildTerminalMarkers = (
  entries: Array<[string, string | number | boolean | undefined]>
): string[] =>
  entries
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => formatTerminalMarker(key, value as string | number | boolean))

export const renderTerminalRunModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  return renderTerminalStream({
    output: readString(obj.output) || '',
    markers: buildTerminalMarkers([
      ['status', readString(obj.status) || 'succeeded'],
      ['terminalId', readString(obj.terminalId)],
      ['readEndPosition', readNumber(obj.readEndPosition)],
      ['hasMoreOutput', typeof obj.hasMoreOutput === 'boolean' ? obj.hasMoreOutput : undefined]
    ])
  })
}

export const renderTerminalReadModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  return renderTerminalStream({
    output: readString(obj.output) || '',
    markers: buildTerminalMarkers([
      ['status', readString(obj.status) || 'succeeded'],
      ['readEndPosition', readNumber(obj.readEndPosition)],
      ['hasMoreOutput', typeof obj.hasMoreOutput === 'boolean' ? obj.hasMoreOutput : undefined]
    ])
  })
}

export const renderTextFileReadModelResult: ModelResultRenderer = ({ args, data }) => {
  const obj = isObject(data) ? data : {}
  const path = readString(args.sourcePath) || ''
  const content = readString(obj.content) || ''
  const startLine = readNumber(obj.startLine) ?? 1
  const endLine = readNumber(obj.endLine) ?? startLine
  const totalLines = readNumber(obj.totalLines) ?? endLine
  const nextStartLine = readNumber(obj.nextStartLine)
  return renderFileEnvelope({
    path,
    type: 'text',
    bodyLines: renderNumberedFileLines({ content, startLine }),
    footer: formatReadRangeFooter({ startLine, endLine, totalLines, nextStartLine })
  })
}

export const renderTextFileEditModelResult: ModelResultRenderer = ({ args }) => {
  const path = readString(args.sourcePath) || ''
  const action = readString(args.action)
  return renderFileMutationProse({
    path,
    verb: action === 'create' ? 'created' : 'updated'
  })
}

export const renderTextFileSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('Text search completed successfully.'),
    `Total matches: ${readNumber(obj.totalMatchCount) ?? 0}`,
    'Returned matches:',
    ...(matches.length
      ? matches.flatMap((item, index) => [
          `  ${index + 1}. line=${readNumber(item.line) ?? ''}; match=${JSON.stringify(readString(item.matchText) || '')}; truncated=${String(item.truncated === true)}`,
          indentBlock(readString(item.textContext) || '', 2)
        ])
      : ['  none'])
  ])
}

const normalizeKbSearchItems = (data: JsonValue | undefined): JsonObject[] => {
  if (!isObject(data) || !Array.isArray(data.items)) return []
  return data.items.filter(isObject)
}

export const renderKbModelError: ModelResultRenderer = ({ data }) => {
  const detail = isObject(data) ? readString(data.error) : ''
  return `${detail ? `Error: ${detail}` : 'Error: kb tool failed.'}\n当前状态下不要继续调用 KB 工具；请告知用户原因，可继续使用其他可用能力。`
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

  return joinGroupedSections([
    renderGroupedHeader('KB search completed successfully.'),
    `Returned matches: ${items.length}`,
    'Sources:',
    ...sourceLines,
    'Matches:',
    ...matchLines
  ])
}

export const renderKbListDocumentsModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const items = Array.isArray(obj.items) ? obj.items.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('KB document listing completed successfully.'),
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
  ])
}

export const renderDocxOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const segments = Array.isArray(obj.segments) ? obj.segments.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('DOCX outline read completed successfully.'),
    `Range: ${readNumber(obj.fromPercent) ?? ''}-${readNumber(obj.toPercent) ?? ''}%; nodeIndex=${readNumber(obj.fromNodeIndex) ?? ''}-${readNumber(obj.toNodeIndex) ?? ''}; totalRootCount=${readNumber(obj.totalRootCount) ?? ''}`,
    'Segments:',
    ...(segments.length
      ? segments.flatMap((segment, index) => [
          `  ${index + 1}. story=${readString(segment.story) || ''}; nodeIndex=${readNumber(segment.fromNodeIndex) ?? ''}-${readNumber(segment.toNodeIndex) ?? ''}`,
          indentBlock(readString(segment.textMap) || '', 2)
        ])
      : ['  none'])
  ])
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
  const totalMatchCount = readNumber(obj.totalMatchCount) ?? 0
  const returnedMatchCount = readNumber(obj.returnedMatchCount) ?? matches.length
  return joinGroupedSections([
    renderGroupedHeader('DOCX search completed successfully.'),
    `Total matches: ${totalMatchCount}`,
    `Returned matches: ${returnedMatchCount}`,
    ...(totalMatchCount > returnedMatchCount ? ['(more matches not returned)'] : []),
    'Matches:',
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
  ])
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

const renderDocxNodeFieldValue = (value: JsonValue, depth: number): string => {
  if (typeof value === 'string') {
    if (!value.includes('\n') && Array.from(value).length <= 160) return JSON.stringify(value)
    return `\n${indentBlock(value, depth + 1)}`
  }
  if (Array.isArray(value) || isObject(value)) {
    return `\n${indentBlock(JSON.stringify(value), depth + 1)}`
  }
  return String(value)
}

const renderDocxNode = (value: JsonValue, depth: number, styles: StyleCatalog): string[] => {
  if (!isObject(value)) return [`${'  '.repeat(depth)}- ${String(value)}`]
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
      blockFields.push([key, renderDocxNodeFieldValue(item, depth + 1).trimStart()])
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
  return joinGroupedSections([
    renderGroupedHeader('DOCX nodes read completed successfully.'),
    'Styles:',
    ...(styles.values.length
      ? styles.values.flatMap(({ id, style }) => [
          `  ${id}:`,
          indentBlock(JSON.stringify(style), 2)
        ])
      : ['  none']),
    'Nodes:',
    ...(nodes.length ? nodes.flatMap((node) => renderDocxNode(node, 1, styles)) : ['  none'])
  ])
}

const readCreatedIds = (data: JsonValue | undefined): string[] => {
  if (!isObject(data) || !Array.isArray(data.createdIds)) return []
  return data.createdIds.filter((item): item is string => typeof item === 'string')
}

export const renderDocxContentEditModelResult: ModelResultRenderer = ({ args, data }) => {
  const path = readString(args.sourcePath) || ''
  const createdIds = readCreatedIds(data)
  return renderFileMutationProse({
    path,
    suffix: createdIds.length ? `Created node IDs: ${createdIds.join(', ')}` : undefined
  })
}

export const renderDocxMutationModelResult: ModelResultRenderer = ({ args, data }) => {
  const path = readString(args.sourcePath) || ''
  const createdIds = readCreatedIds(data)
  return renderFileMutationProse({
    path,
    suffix: createdIds.length ? `Created node IDs: ${createdIds.join(', ')}` : undefined
  })
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
    return joinGroupedSections([
      renderGroupedHeader('Excel workbook read completed.'),
      'Sheets:',
      ...(sheets.length
        ? sheets.map((sheet, index) => {
            const range = readString(sheet.range) || 'empty'
            return `  ${index + 1}. ${readString(sheet.name) || ''}  ${range}  rows=${readNumber(sheet.rowCount) ?? 0} cols=${readNumber(sheet.columnCount) ?? 0}`
          })
        : ['  none'])
    ])
  }
  if (type === 'search' || Array.isArray(obj.matches)) {
    const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
    const totalMatchCount = readNumber(obj.totalMatchCount) ?? matches.length
    const returnedMatchCount = readNumber(obj.returnedMatchCount) ?? matches.length
    return joinGroupedSections([
      renderGroupedHeader('Excel search completed.'),
      `Total matches: ${totalMatchCount}`,
      `Returned matches: ${returnedMatchCount}`,
      ...(totalMatchCount > returnedMatchCount ? ['(more matches not returned)'] : []),
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
    ])
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
    return joinGroupedSections([
      renderGroupedHeader('Excel style read completed.'),
      `Sheet: ${sheetName}`,
      `Range: ${rangeMetadata}`,
      '| Cell | bold | fontColor | fillColor | numberFormat |',
      '| --- | --- | --- | --- | --- |',
      ...(styleRows.length ? styleRows : ['| none | | | | |'])
    ])
  }
  return joinGroupedSections([
    renderGroupedHeader('Excel range read completed.'),
    `Sheet: ${sheetName}`,
    `Range: ${rangeMetadata}`,
    ...(rows.length
      ? rows.map((row, rowIndex) => {
          if (!Array.isArray(row)) return ''
          const rowNumber = origin ? origin.top + rowIndex : rowIndex + 1
          return `| ${rowNumber} | ${row.map((cell) => formatExcelRangeCell(cell)).join(' | ')} |`
        })
      : ['  none'])
  ])
}

export const renderExcelEditModelResult: ModelResultRenderer = ({ args }) => {
  const type = typeof args.type === 'string' ? args.type : 'edit'
  return renderPlainConfirmation(`Excel ${type} completed.`)
}

export const renderPdfOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const metadata = isObject(obj.metadata) ? obj.metadata : {}
  const outline = Array.isArray(obj.outline) ? obj.outline.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('PDF outline read completed.'),
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
  ])
}

export const renderPdfSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('PDF search completed.'),
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
  ])
}

export const renderPdfReadPagesModelResult: ModelResultRenderer = ({ args, data }) => {
  const obj = isObject(data) ? data : {}
  const path = readString(args.sourcePath) || readString(obj.sourcePath) || ''
  const pages = Array.isArray(obj.pages) ? obj.pages.filter(isObject) : []
  const bodyLines = pages.length
    ? pages.flatMap((page) => {
        const pageNumber = readNumber(page.pageNumber) ?? ''
        const textStatus = readString(page.textStatus) || ''
        const imageCount = readNumber(page.imageCount) ?? 0
        const pageImagePath = readString(page.pageImagePath) || ''
        const text = readString(page.text) || ''
        const lines = [`Page ${pageNumber} [${textStatus}, ${imageCount} images]`]
        if (pageImagePath) lines.push(`pageImagePath: ${pageImagePath}`)
        if (text) lines.push(...renderNumberedFileLines({ content: text, startLine: 1 }))
        else if (textStatus === 'empty') lines.push('(no text layer)')
        return lines
      })
    : ['(no pages)']
  return renderFileEnvelope({ path, type: 'pdf', bodyLines })
}

export const renderWebSearchModelResult: ModelResultRenderer = ({ args, data }) => {
  const type = readString(args.type)
  const obj = isObject(data) ? data : {}
  if (type === 'fetch') {
    const title = readString(obj.title) || readString(obj.requestedUrl) || ''
    const requestedUrl = readString(obj.requestedUrl) || readString(args.url) || ''
    const finalUrl = readString(obj.finalUrl) || requestedUrl
    const markdown = readString(obj.markdown) || ''
    const pageLabel = [title, finalUrl].filter(Boolean).join(' — ')
    return renderUntrustedWebContent([
      'Web page fetched.',
      pageLabel ? `Page: ${pageLabel}` : '',
      markdown || '(empty)'
    ])
  }

  const query = readString(obj.query) || readString(args.query) || ''
  const results = Array.isArray(obj.results) ? obj.results.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('Web search completed.'),
    query ? `Query: ${query}` : '',
    `Results: ${results.length}`,
    ...(results.length
      ? results.flatMap((item, index) => {
          const rank = readNumber(item.rank) ?? index + 1
          const title = readString(item.title) || ''
          const url = readString(item.url) || ''
          const snippet = readString(item.snippet) || ''
          return [
            `  ${index + 1}. [${rank}] ${title}`,
            url ? `     url: ${url}` : '',
            snippet ? indentBlock(snippet, 2) : '     snippet: (none)'
          ].filter(Boolean)
        })
      : ['  none'])
  ])
}

export const renderBrowserUseModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const error = readString(obj.error)
  if (error) return `Error: ${error}`
  const action = readString(obj.action) || ''
  const tabId = readString(obj.tabId) || ''
  const page = isObject(obj.page) ? obj.page : {}
  const pageLabel = [readString(page.title), readString(page.url)].filter(Boolean).join(' — ')
  const tabLine = tabId ? `Tab: ${tabId}` : ''
  if (action === 'navigate') {
    const title = readString(page.title)
    const url = readString(page.url)
    const note = readString(obj.note)
    return renderProse([
      'Browser navigate completed.',
      tabLine,
      title ? `Title: ${title}` : '',
      url ? `URL: ${url}` : '',
      note ? `Note: ${note}` : ''
    ])
  }
  if (action === 'list_tabs') {
    const tabs = Array.isArray(obj.tabs) ? obj.tabs.filter(isObject) : []
    return renderProse([
      'Browser list_tabs completed.',
      'Tabs:',
      ...(tabs.length
        ? tabs.flatMap((tab, index) => {
            const id = readString(tab.tabId) || ''
            const active = tab.active === true
            const label = [readString(tab.title), readString(tab.url)].filter(Boolean).join(' — ')
            return [
              `  ${index + 1}. tabId=${id}; active=${active ? 'true' : 'false'}`,
              label ? `     ${label}` : ''
            ]
          })
        : ['  none'])
    ])
  }
  if (action === 'extract') {
    const content = readString(obj.content) || ''
    return renderUntrustedWebContent([
      'Browser extract completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      'Content:',
      content || '(empty)'
    ])
  }
  if (action === 'observe') {
    const actions = Array.isArray(obj.actions) ? obj.actions.filter(isObject) : []
    return renderProse([
      'Browser observe completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      'Actions:',
      ...(actions.length
        ? actions.flatMap((item, index) => {
            const actionId = readString(item.actionId) || ''
            const method = readString(item.method) || ''
            const args = Array.isArray(item.arguments)
              ? item.arguments.map((value) => String(value))
              : []
            const selector = readString(item.selector) || ''
            const description = readString(item.description) || ''
            return [
              `  ${index + 1}. actionId=${actionId}; method=${method}; arguments=${JSON.stringify(args)}`,
              selector ? `     selector: ${selector}` : '',
              description ? `     ${description}` : ''
            ]
          })
        : ['  none'])
    ])
  }
  if (action === 'act') {
    const executed = isObject(obj.executed) ? obj.executed : {}
    const executedArgs = Array.isArray(executed.arguments)
      ? executed.arguments.map((value) => String(value))
      : []
    const executedLine = [
      readString(executed.actionId) ? `actionId=${readString(executed.actionId)}` : '',
      readString(executed.method) ? `method=${readString(executed.method)}` : '',
      `arguments=${JSON.stringify(executedArgs)}`
    ]
      .filter(Boolean)
      .join('; ')
    return renderProse([
      'Browser act completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      readString(obj.message) ? `Message: ${readString(obj.message)}` : '',
      readString(obj.actionDescription) ? `Action: ${readString(obj.actionDescription)}` : '',
      executedLine ? `Executed: ${executedLine}` : '',
      readString(executed.selector) ? `selector: ${readString(executed.selector)}` : ''
    ])
  }
  if (action === 'act_instruction') {
    return renderProse([
      'Browser act_instruction completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      readString(obj.message) ? `Message: ${readString(obj.message)}` : '',
      readString(obj.actionDescription) ? `Action: ${readString(obj.actionDescription)}` : ''
    ])
  }
  if (action === 'screenshot') {
    return renderProse([
      'Browser screenshot completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      readString(obj.path) ? `Path: ${readString(obj.path)}` : ''
    ])
  }
  if (action === 'scroll') {
    return renderProse([
      'Browser scroll completed.',
      tabLine,
      pageLabel ? `Page: ${pageLabel}` : '',
      readString(obj.message) ? `Result: ${readString(obj.message)}` : ''
    ])
  }
  return renderProse([
    'Browser action completed.',
    action ? `Action: ${action}` : '',
    tabLine,
    pageLabel ? `Page: ${pageLabel}` : ''
  ])
}

export const renderBrowserUseModelError: ModelResultRenderer = (input) => {
  const obj = isObject(input.data) ? input.data : {}
  const action = readString(obj.action) || ''
  const tabId = readString(obj.tabId) || ''
  const page = isObject(obj.page) ? obj.page : {}
  const pageLabel = [readString(page.title), readString(page.url)].filter(Boolean).join(' — ')
  if (action === 'act') {
    const message = readString(obj.message) || readString(obj.error) || ''
    const executed = isObject(obj.executed) ? obj.executed : {}
    const executedArgs = Array.isArray(executed.arguments)
      ? executed.arguments.map((value) => String(value))
      : []
    const executedLine = [
      readString(executed.actionId) ? `actionId=${readString(executed.actionId)}` : '',
      readString(executed.method) ? `method=${readString(executed.method)}` : '',
      `arguments=${JSON.stringify(executedArgs)}`
    ]
      .filter(Boolean)
      .join('; ')
    return renderProse([
      'Browser act failed.',
      tabId ? `Tab: ${tabId}` : '',
      pageLabel ? `Page: ${pageLabel}` : '',
      message ? `Message: ${message}` : '',
      readString(obj.actionDescription) ? `Action: ${readString(obj.actionDescription)}` : '',
      executedLine ? `Executed: ${executedLine}` : '',
      readString(executed.selector) ? `selector: ${readString(executed.selector)}` : ''
    ])
  }
  const detail = readString(obj.error) || readString(obj.message) || `${input.toolName} failed.`
  return renderProse([`Error: ${detail}`, tabId ? `Tab: ${tabId}` : ''])
}

export const renderPlanUpdateModelResult: ModelResultRenderer = () =>
  renderPlainConfirmation('Plan updated successfully.')

export const renderPptOutlineModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const slides = Array.isArray(obj.slides) ? obj.slides.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('PPT outline read completed successfully.'),
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
  ])
}

export const renderPptReadSlidesModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const slides = Array.isArray(obj.slides) ? obj.slides.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('PPT slides read completed successfully.'),
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
              if (isObject(element.bounds)) {
                lines.push(`          bounds: ${JSON.stringify(element.bounds)}`)
              }
              const text = readString(element.text)
              if (text) lines.push('          text:', indentBlock(text, 6))
              const latex = readString(element.latex)
              if (latex) lines.push(`          latex: ${latex}`)
              if (isObject(element.details)) {
                // Cell paragraph formatting is not needed to understand source content.
                const details = Object.fromEntries(
                  Object.entries(element.details).filter(([key]) => key !== 'paragraphs')
                )
                if (Object.keys(details).length) {
                  lines.push(`          details: ${JSON.stringify(details)}`)
                }
              }
            })
          }
          return lines.filter(Boolean)
        })
      : ['  none'])
  ])
}

export const renderPptSearchModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const matches = Array.isArray(obj.matches) ? obj.matches.filter(isObject) : []
  return joinGroupedSections([
    renderGroupedHeader('PPT search completed successfully.'),
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
  ])
}

export const renderPptEditModelResult: ModelResultRenderer = ({ args, data }) => {
  const path = readString(args.sourcePath) || ''
  const obj = isObject(data) ? data : {}
  const createdElementIds = Array.isArray(obj.createdElementIds)
    ? obj.createdElementIds.filter((item): item is string => typeof item === 'string')
    : []
  return renderFileMutationProse({
    path,
    suffix: createdElementIds.length
      ? `Created element IDs: ${createdElementIds.join(', ')}`
      : undefined
  })
}

export const renderImageGenerateModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const error = readString(obj.error)
  if (error) return `Error: ${error}`
  const outputPath = readString(obj.outputPath)
  return outputPath
    ? renderPlainConfirmation(`Image saved: ${outputPath}`)
    : renderPlainConfirmation('Image generation completed.')
}

export const renderReadImageModelResult: ModelResultRenderer = ({ data }) => {
  const obj = isObject(data) ? data : {}
  const images = Array.isArray(obj.images) ? obj.images.filter(isObject) : []
  if (images.length === 0) return renderPlainConfirmation('No images loaded.')
  if (images.length === 1) {
    const image = images[0]
    const imagePath = readString(image.path) || ''
    const width = readNumber(image.width)
    const height = readNumber(image.height)
    const mimeType = readString(image.mimeType) || ''
    const bodyLines = [
      ...(width && height ? [`dimensions: ${width}x${height}`] : []),
      ...(mimeType ? [`mimeType: ${mimeType}`] : [])
    ]
    return renderFileEnvelope({
      path: imagePath,
      type: 'image',
      bodyLines: bodyLines.length ? bodyLines : ['(loaded)']
    })
  }
  return joinGroupedSections([
    renderGroupedHeader(`${images.length} images loaded:`),
    ...images.map((image, index) => {
      const imagePath = readString(image.path) || ''
      const width = readNumber(image.width) ?? ''
      const height = readNumber(image.height) ?? ''
      const mimeType = readString(image.mimeType) || ''
      const sizeLabel = width && height ? `${width}x${height}` : ''
      const meta = [sizeLabel, mimeType.replace(/^image\//u, '')].filter(Boolean).join(' ')
      return `  ${index + 1}. ${imagePath}${meta ? ` ${meta}` : ''}`
    })
  ])
}

export const renderLoadSkillModelResult: ModelResultRenderer = ({ data }) => {
  const outcome = isObject(data) ? data : {}
  const names = (key: string): string[] =>
    Array.isArray(outcome[key])
      ? outcome[key].filter((value): value is string => typeof value === 'string')
      : []
  const loaded = names('loadedSkillNames')
  const duplicates = names('skippedDuplicateSkillNames')
  const unavailable = Array.isArray(outcome.unavailableSkills)
    ? outcome.unavailableSkills.filter(isObject)
    : []
  return [
    loaded.length ? `Loaded: ${loaded.join(', ')}.` : '',
    duplicates.length ? `Already loaded: ${duplicates.join(', ')}.` : '',
    ...unavailable.map((item) => `Unavailable ${readString(item.name)}: ${readString(item.error)}.`)
  ]
    .filter(Boolean)
    .join(' ')
}

export const renderLoadToolsetModelResult: ModelResultRenderer = ({ args }) => {
  const requested = Array.isArray(args.toolsetNames)
    ? args.toolsetNames.filter((item): item is string => typeof item === 'string')
    : []
  return renderPlainConfirmation(
    `Toolset loaded successfully: ${requested.join(', ') || 'requested toolset'}.`
  )
}

export const renderModelResultWith = (
  renderer: ModelResultRenderer | undefined,
  input: ModelResultRendererInput
): string => (renderer || renderGenericModelResult)(input)

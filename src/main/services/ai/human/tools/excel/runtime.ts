import { writeReviewIndex } from '../../../fileChanges/reviewNavigationIndex'
import type { ReviewRegion } from '../../../../../../shared/fileReview'
import type { ExcelSheetAxes, FileChangeIdentity } from '../../../fileChanges/FileChangeSession'
import ExcelJS from 'exceljs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
import { resolveToolPath } from '../terminal/commandPolicy'
import type { ExcelCapabilityToolsInput, ExcelToolRuntime } from './types'
import type { ExcelEditInput, ExcelReadInput, ExcelStyle } from './toolSchemas'
import { toExcelArgb, toExcelRgb } from './color'
import { EXCEL_SEARCH_MAX_MATCHES } from './constants'
import { calculateExcelFormulas } from './formula'
import { excelCellValue } from '../../../../../../shared/excelWorkbook'

const EXCEL_READ_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm'])
const EXCEL_WRITE_EXTENSIONS = new Set(['.xlsx'])
const GREEN = 'FF22A06B'
const RED = 'FFD14343'

const assertExcelPath = (sourcePath: string, mode: 'read' | 'write'): void => {
  const extension = path.extname(sourcePath).toLowerCase()
  if (!EXCEL_READ_EXTENSIONS.has(extension)) {
    throw new Error('Excel 工具只支持 .xlsx、.xlsm、.xltx 和 .xltm 文件')
  }
  if (mode === 'write' && !EXCEL_WRITE_EXTENSIONS.has(extension)) {
    throw new Error('excel_edit 只支持 .xlsx，避免写回时丢失宏或模板信息')
  }
}

const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const toJsonObject = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject

const getFormula = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined
  if ('formula' in value) {
    const formula = String((value as { formula?: unknown }).formula || '')
    return formula || undefined
  }
  if ('sharedFormula' in value) {
    const formula = String((value as { sharedFormula?: unknown }).sharedFormula || '')
    return formula || undefined
  }
  return undefined
}

const columnNumber = (letters: string): number =>
  letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)

const columnLetters = (column: number): string => {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

const usedRange = (sheet: ExcelJS.Worksheet): string | null => {
  if (sheet.actualRowCount === 0 || sheet.actualColumnCount === 0) return null
  const dimensions = sheet.dimensions
  return `${columnLetters(dimensions.left)}${dimensions.top}:${sheet.getCell(dimensions.bottom, dimensions.right).address}`
}

const parseRange = (
  range: string
): { top: number; left: number; bottom: number; right: number } => {
  const match = range.trim().match(/^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/)
  if (!match) throw new Error(`无效的 A1 范围: ${range}`)
  const left = columnNumber(match[1])
  const top = Number(match[2])
  const right = columnNumber(match[3] || match[1])
  const bottom = Number(match[4] || match[2])
  if (bottom < top || right < left) throw new Error(`无效的 A1 范围: ${range}`)
  return { top, left, bottom, right }
}

const loadWorkbook = async (bytes: Uint8Array): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  return workbook
}

const readBytes = async (sourcePath: string): Promise<Buffer> => await fs.readFile(sourcePath)

type CellChange = {
  sheetName: string
  address: string
  kind: 'added' | 'modified' | 'deleted'
  target: ReviewRegion['target']
}

const reviewCellValue = (cell: ExcelJS.Cell, date1904: boolean): string => {
  const source = cell.master
  if (source.formula) return source.formula
  if (source.value instanceof Date)
    return String(25569 + source.value.getTime() / 86400000 - (date1904 ? 1462 : 0))
  return source.text || ''
}
const cloneModel = <T>(value: T): T => structuredClone(value)
const cellFingerprint = (cell: ExcelJS.Cell): string =>
  JSON.stringify({
    value: cell.formula ? { formula: cell.formula } : cell.value,
    style: cell.style || {}
  })
const setBorder = (cell: ExcelJS.Cell, color: string): void => {
  const border = { style: 'medium' as const, color: { argb: color } }
  cell.border = { top: border, right: border, bottom: border, left: border }
}
const sheetBounds = (sheet: ExcelJS.Worksheet) => {
  const model = sheet.model as ExcelJS.WorksheetModel & {
    rows: { number: number }[]
    cols?: { max: number }[]
  }
  return {
    rows: Math.max(
      sheet.rowCount,
      ...model.rows.map((row) => row.number),
      ...model.merges.map((range) => parseRange(range).bottom),
      1
    ),
    columns: Math.max(
      sheet.columnCount,
      ...(model.cols || []).map((col) => col.max),
      ...model.merges.map((range) => parseRange(range).right),
      1
    )
  }
}
type AxisPair = { before?: number; after?: number }
const extendAxis = (axis: (number | null)[], size: number): void => {
  let next = Math.max(0, ...axis.filter((value): value is number => value !== null)) + 1
  while (axis.length < size) axis.push(next++)
}
const alignAxis = (axis: (number | null)[], beforeSize: number, afterSize: number): AxisPair[] => {
  const current = [...axis]
  extendAxis(current, afterSize)
  const size = Math.max(beforeSize, ...current.filter((value): value is number => value !== null))
  const present = new Set(current)
  const result: AxisPair[] = []
  let old = 1
  current.forEach((origin, index) => {
    if (origin !== null) {
      while (old < origin) {
        if (!present.has(old)) result.push({ before: old })
        old++
      }
      old = origin + 1
    }
    result.push({ before: origin ?? undefined, after: index + 1 })
  })
  while (old <= size) {
    if (!present.has(old)) result.push({ before: old })
    old++
  }
  return result
}
const legalDeletedName = (name: string, used: Set<string>): string => {
  let index = 1,
    output = ''
  do {
    const suffix = index === 1 ? '（已删除）' : `（已删除${index}）`
    output = name.slice(0, 31 - suffix.length) + suffix
    index++
  } while (used.has(output.toLowerCase()))
  used.add(output.toLowerCase())
  return output
}
const buildDiffWorkbook = async (input: {
  before: ExcelJS.Workbook | null
  after: ExcelJS.Workbook
  sheetLineage: ReadonlyMap<string, string | null>
  axes?: ExcelSheetAxes[]
}): Promise<{ bytes: Buffer; changes: CellChange[] }> => {
  const review = new ExcelJS.Workbook()
  const changes: CellChange[] = []
  const names = new Set(input.after.worksheets.map((sheet) => sheet.name.toLowerCase()))
  const outputs: { before?: ExcelJS.Worksheet; after?: ExcelJS.Worksheet; name: string }[] = []
  for (const before of input.before?.worksheets || []) {
    const finalName = [...input.sheetLineage].find(([, baseline]) => baseline === before.name)?.[0]
    const after = finalName ? input.after.getWorksheet(finalName) : undefined
    outputs.push({ before, after, name: after?.name || legalDeletedName(before.name, names) })
  }
  for (const after of input.after.worksheets) {
    if (input.sheetLineage.get(after.name) === null) outputs.push({ after, name: after.name })
  }
  for (const output of outputs) {
    const { before, after } = output
    const sheet = review.addWorksheet(output.name)
    const source = after || before!
    // Keep workbook and worksheet properties, styles, formulas and dimensions; rows are rebuilt with logical axes.
    sheet.properties = cloneModel(source.properties)
    sheet.pageSetup = cloneModel(source.pageSetup)
    sheet.views = cloneModel(source.views)
    const oldBounds = before ? sheetBounds(before) : { rows: 0, columns: 0 }
    const newBounds = after ? sheetBounds(after) : { rows: 0, columns: 0 }
    const identity = input.axes?.find((axis) => axis.sheet === after?.name)
    const rowAxes =
      identity?.rows || Array.from({ length: newBounds.rows }, (_, i) => (before ? i + 1 : null))
    const colAxes =
      identity?.columns ||
      Array.from({ length: newBounds.columns }, (_, i) => (before ? i + 1 : null))
    const rows = !after
      ? Array.from({ length: oldBounds.rows }, (_, i) => ({ before: i + 1 }) as AxisPair)
      : alignAxis(rowAxes, oldBounds.rows, newBounds.rows)
    const columns = !after
      ? Array.from({ length: oldBounds.columns }, (_, i) => ({ before: i + 1 }) as AxisPair)
      : alignAxis(colAxes, oldBounds.columns, newBounds.columns)
    const mark = (row: number, col: number, kind: CellChange['kind']) => {
      const cell = sheet.getCell(row, col)
      setBorder(cell, kind === 'deleted' ? RED : GREEN)
      if (
        !changes.some(
          (change) => change.sheetName === sheet.name && change.address === cell.address
        )
      ) {
        const rr =
          rows[row - 1]?.after ||
          rows.slice(row).find((p) => p.after)?.after ||
          [...rows.slice(0, row)].reverse().find((p) => p.after)?.after
        const cc =
          columns[col - 1]?.after ||
          columns.slice(col).find((p) => p.after)?.after ||
          [...columns.slice(0, col)].reverse().find((p) => p.after)?.after
        const destination = after && rr && cc ? after.getCell(rr, cc) : undefined
        changes.push({
          sheetName: sheet.name,
          address: cell.address,
          kind,
          target: destination
            ? {
                kind: 'excel',
                sheet: after!.name,
                address:
                  after!.model.merges.find((merge) => {
                    const bounds = parseRange(merge)
                    return (
                      rr! >= bounds.top &&
                      rr! <= bounds.bottom &&
                      cc! >= bounds.left &&
                      cc! <= bounds.right
                    )
                  }) || destination.address,
                value: reviewCellValue(destination, Boolean(input.after.properties.date1904)),
                container: !rows[row - 1]?.after || !columns[col - 1]?.after
              }
            : null
        })
      }
    }
    columns.forEach((pair, col) => {
      const sourceColumn = pair.after
        ? after?.getColumn(pair.after)
        : before?.getColumn(pair.before!)
      if (sourceColumn) {
        sheet.getColumn(col + 1).width = sourceColumn.width
        sheet.getColumn(col + 1).hidden = sourceColumn.hidden
        sheet.getColumn(col + 1).outlineLevel = sourceColumn.outlineLevel
      }
      if (pair.before && pair.after && before && after) {
        const old = before.getColumn(pair.before),
          next = after.getColumn(pair.after)
        if (
          old.width !== next.width ||
          old.hidden !== next.hidden ||
          old.outlineLevel !== next.outlineLevel
        )
          mark(1, col + 1, 'modified')
      }
    })
    rows.forEach((rowPair, rowIndex) => {
      const sourceRow = rowPair.after
        ? after?.getRow(rowPair.after)
        : before?.getRow(rowPair.before!)
      const row = sheet.getRow(rowIndex + 1)
      if (sourceRow) {
        row.height = sourceRow.height
        row.hidden = sourceRow.hidden
        row.outlineLevel = sourceRow.outlineLevel
      }
      columns.forEach((colPair, colIndex) => {
        const old =
          before && rowPair.before && colPair.before
            ? before.getCell(rowPair.before, colPair.before)
            : undefined
        const next =
          after && rowPair.after && colPair.after
            ? after.getCell(rowPair.after, colPair.after)
            : undefined
        const cell = sheet.getCell(rowIndex + 1, colIndex + 1)
        const sourceCell = next || old
        const border = cell.border
        if (sourceCell) {
          cell.value = cloneModel(excelCellValue(sourceCell))
          cell.style = cloneModel(sourceCell.style)
        }
        if (border?.top?.color) cell.border = border
        if (!before || !rowPair.before || !colPair.before) mark(rowIndex + 1, colIndex + 1, 'added')
        else if (!after || !rowPair.after || !colPair.after)
          mark(rowIndex + 1, colIndex + 1, 'deleted')
        else if (old && next && cellFingerprint(old) !== cellFingerprint(next)) {
          const deleted =
            old.value !== null && old.value !== '' && (next.value === null || next.value === '')
          if (deleted) {
            cell.value = cloneModel(excelCellValue(old))
            cell.style = cloneModel(old.style)
          }
          mark(rowIndex + 1, colIndex + 1, deleted ? 'deleted' : 'modified')
        }
      })
      if (before && after && rowPair.before && rowPair.after) {
        const old = before.getRow(rowPair.before),
          next = after.getRow(rowPair.after)
        if (
          old.height !== next.height ||
          old.hidden !== next.hidden ||
          old.outlineLevel !== next.outlineLevel
        )
          mark(rowIndex + 1, 1, 'modified')
      }
    })
    const mapMerge = (range: string, side: 'before' | 'after') => {
      const bounds = parseRange(range)
      const rr = rows
        .map((pair, index) => ({ value: pair[side], index }))
        .filter((item) => item.value && item.value >= bounds.top && item.value <= bounds.bottom)
      const cc = columns
        .map((pair, index) => ({ value: pair[side], index }))
        .filter((item) => item.value && item.value >= bounds.left && item.value <= bounds.right)
      if (!rr.length || !cc.length) return undefined
      return `${columnLetters(cc[0].index + 1)}${rr[0].index + 1}:${columnLetters(cc[cc.length - 1].index + 1)}${rr[rr.length - 1].index + 1}`
    }
    const oldMerges = new Set(
      (before?.model.merges || [])
        .map((range) => mapMerge(range, 'before'))
        .filter((value): value is string => Boolean(value))
    )
    const newMerges = new Set(
      (after?.model.merges || [])
        .map((range) => mapMerge(range, 'after'))
        .filter((value): value is string => Boolean(value))
    )
    for (const range of new Set([...oldMerges, ...newMerges])) {
      const bounds = parseRange(range)
      if (!oldMerges.has(range) || !newMerges.has(range))
        mark(bounds.top, bounds.left, newMerges.has(range) ? 'modified' : 'deleted')
      if (newMerges.has(range) || !after) sheet.mergeCells(range)
    }
    if (before && after && before.name !== after.name) mark(1, 1, 'modified')
    if (changes.some((change) => change.sheetName === sheet.name))
      sheet.properties.tabColor = { argb: after ? GREEN : RED }
  }
  return { bytes: Buffer.from(await review.xlsx.writeBuffer()), changes }
}

const applyStyle = (cell: ExcelJS.Cell, style: ExcelStyle | undefined): void => {
  if (!style) return
  if (cell.isMerged && cell.master !== cell) applyStyle(cell.master, style)
  cell.style = cloneModel(cell.style)
  const currentFont = cell.font || {}
  if (typeof style.bold === 'boolean' || typeof style.italic === 'boolean' || style.fontColor) {
    cell.font = {
      ...currentFont,
      bold: typeof style.bold === 'boolean' ? style.bold : currentFont.bold,
      italic: typeof style.italic === 'boolean' ? style.italic : currentFont.italic,
      color: style.fontColor ? { argb: toExcelArgb(style.fontColor) } : currentFont.color
    }
  }
  if (style.fillColor)
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: toExcelArgb(style.fillColor) }
    }
  if (style.numberFormat) cell.numFmt = String(style.numberFormat)
  if (style.horizontalAlignment || style.verticalAlignment) {
    const currentAlignment = cell.alignment || {}
    cell.alignment = {
      ...currentAlignment,
      horizontal: style.horizontalAlignment || currentAlignment.horizontal,
      vertical: style.verticalAlignment || currentAlignment.vertical
    }
  }
}

const toColumnNumber = (column: string | number): number =>
  typeof column === 'number' ? column : columnNumber(String(column))

const requireSheet = (workbook: ExcelJS.Workbook, sheetName: string): ExcelJS.Worksheet => {
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) throw new Error(`工作表不存在: ${sheetName}`)
  return sheet
}

const serializeLiteral = (
  value: unknown,
  fallbackText: string
): string | number | boolean | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value) {
    const text = (value as { text?: unknown }).text
    if (typeof text === 'string') return text
  }
  if (typeof value === 'object' && 'richText' in value) {
    const richText = (value as { richText?: Array<{ text?: string }> }).richText
    if (Array.isArray(richText)) return richText.map((part) => part.text || '').join('')
  }
  return fallbackText || null
}

const projectRangeCell = (
  cell: ExcelJS.Cell
):
  | string
  | number
  | boolean
  | null
  | { formula: string; value?: string | number | boolean | null } => {
  const formula = getFormula(cell.value)
  if (formula) {
    const result = cell.result
    const serialized = result === undefined ? undefined : serializeLiteral(result, cell.text)
    return serialized === undefined || serialized === null
      ? { formula }
      : { formula, value: serialized }
  }
  return serializeLiteral(cell.value, cell.text)
}

const projectStyleCell = (
  cell: ExcelJS.Cell
): { bold?: boolean; fontColor?: string; fillColor?: string; numberFormat?: string } | null => {
  const style: { bold?: boolean; fontColor?: string; fillColor?: string; numberFormat?: string } =
    {}
  if (cell.font?.bold) style.bold = true
  const fontColor = toExcelRgb(cell.font?.color?.argb)
  if (fontColor) style.fontColor = fontColor
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.fgColor?.argb) {
    const fillColor = toExcelRgb(fill.fgColor.argb)
    if (fillColor) style.fillColor = fillColor
  }
  if (cell.numFmt) style.numberFormat = cell.numFmt
  return Object.keys(style).length > 0 ? style : null
}

const readGrid = <T>(
  sheet: ExcelJS.Worksheet,
  range: { top: number; left: number; bottom: number; right: number },
  project: (cell: ExcelJS.Cell) => T
): T[][] => {
  const rows: T[][] = []
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: T[] = []
    for (let column = range.left; column <= range.right; column += 1) {
      cells.push(project(sheet.getCell(row, column)))
    }
    rows.push(cells)
  }
  return rows
}

const toCellValue = (value: unknown): ExcelJS.CellValue => {
  if (value && typeof value === 'object' && 'formula' in value) {
    const formula = String((value as { formula: string }).formula).replace(/^=/, '')
    return { formula }
  }
  return value as ExcelJS.CellValue
}

const applyOperation = (input: {
  workbook: ExcelJS.Workbook
  operation: ExcelEditInput
  sheetLineage: Map<string, string | null>
}): void => {
  const { workbook, operation, sheetLineage } = input
  if (operation.type === 'add_sheet') {
    if (workbook.getWorksheet(operation.sheetName))
      throw new Error(`工作表已存在: ${operation.sheetName}`)
    workbook.addWorksheet(operation.sheetName)
    sheetLineage.set(operation.sheetName, null)
    return
  }
  if (operation.type === 'delete_sheet') {
    const sheet = requireSheet(workbook, operation.sheetName)
    if (workbook.worksheets.length === 1) throw new Error('Excel 最终必须至少保留一个工作表')
    workbook.removeWorksheet(sheet.id)
    sheetLineage.delete(sheet.name)
    return
  }
  if (operation.type === 'rename_sheet') {
    const sheet = requireSheet(workbook, operation.sheetName)
    if (workbook.getWorksheet(operation.newName))
      throw new Error(`工作表已存在: ${operation.newName}`)
    const previousName = sheet.name
    sheet.name = operation.newName
    const baselineName = sheetLineage.get(previousName) ?? null
    sheetLineage.delete(previousName)
    sheetLineage.set(sheet.name, baselineName)
    return
  }

  const sheet = requireSheet(workbook, operation.sheetName)
  if (operation.type === 'set_range') {
    const range = parseRange(operation.range)
    const expectedRows = range.bottom - range.top + 1
    const expectedColumns = range.right - range.left + 1
    const rowCount = operation.values.length
    if (
      rowCount !== expectedRows ||
      operation.values.some((row) => row.length !== expectedColumns)
    ) {
      throw new Error(
        `set_range 的 values 行列必须与 range ${operation.range} 一致（${String(expectedRows)}x${String(expectedColumns)}）`
      )
    }
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const values = operation.values[rowIndex]
      for (let columnIndex = 0; columnIndex < values.length; columnIndex += 1) {
        const cell = sheet.getCell(range.top + rowIndex, range.left + columnIndex)
        cell.value = toCellValue(values[columnIndex])
        applyStyle(cell, operation.style)
      }
    }
    return
  }
  if (operation.type === 'clear_range') {
    const range = parseRange(operation.range)
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        sheet.getCell(row, column).value = null
      }
    }
    return
  }
  if (operation.type === 'merge_cells') {
    sheet.mergeCells(operation.range)
    return
  }
  if (operation.type === 'unmerge_cells') {
    const firstCell = sheet.getCell(operation.range.split(':')[0])
    if (!firstCell.isMerged) return
    sheet.unMergeCells(operation.range)
    return
  }
  if (
    operation.type === 'insert_rows' ||
    operation.type === 'delete_rows' ||
    operation.type === 'insert_columns' ||
    operation.type === 'delete_columns'
  ) {
    const rows = operation.type === 'insert_rows' || operation.type === 'delete_rows'
    const inserting = operation.type === 'insert_rows' || operation.type === 'insert_columns'
    const start =
      'startRow' in operation ? operation.startRow : toColumnNumber(operation.startColumn)
    const merges = [...sheet.model.merges].map(parseRange)
    for (const range of [...sheet.model.merges]) sheet.unMergeCells(range)
    if (rows)
      sheet.spliceRows(
        start,
        inserting ? 0 : operation.count,
        ...Array.from({ length: inserting ? operation.count : 0 }, () => [])
      )
    else
      sheet.spliceColumns(
        start,
        inserting ? 0 : operation.count,
        ...Array.from({ length: inserting ? operation.count : 0 }, () => [])
      )
    const transform = (lo: number, hi: number): [number, number] | undefined => {
      if (inserting)
        return [lo >= start ? lo + operation.count : lo, hi >= start ? hi + operation.count : hi]
      const last = start + operation.count - 1
      if (lo >= start && hi <= last) return undefined
      return [
        lo > last ? lo - operation.count : lo >= start ? start : lo,
        hi > last ? hi - operation.count : hi >= start ? start - 1 : hi
      ]
    }
    for (const range of merges) {
      const span = transform(rows ? range.top : range.left, rows ? range.bottom : range.right)
      if (!span || span[1] < span[0]) continue
      if (rows) {
        range.top = span[0]
        range.bottom = span[1]
      } else {
        range.left = span[0]
        range.right = span[1]
      }
      if (range.top !== range.bottom || range.left !== range.right)
        sheet.mergeCells(
          `${columnLetters(range.left)}${range.top}:${columnLetters(range.right)}${range.bottom}`
        )
    }
    return
  }
  if (operation.type === 'set_style') {
    const range = parseRange(operation.range)
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        applyStyle(sheet.getCell(row, column), operation.style)
      }
    }
    return
  }
  if (operation.type === 'set_column_width') {
    sheet.getColumn(operation.column).width = operation.width
    return
  }
  if (operation.type === 'set_row_height') {
    sheet.getRow(operation.row).height = operation.height
    return
  }
  const range = parseRange(operation.range)
  for (let column = range.left; column <= range.right; column += 1) {
    let maxLength = 8
    for (let row = range.top; row <= range.bottom; row += 1) {
      const text = sheet.getCell(row, column).text || ''
      maxLength = Math.max(maxLength, Array.from(text).length + 2)
    }
    sheet.getColumn(column).width = Math.min(maxLength, 60)
  }
}

export const createExcelToolRuntime = (input: ExcelCapabilityToolsInput): ExcelToolRuntime => {
  const currentBytesByPath = new Map<string, Buffer>()
  const resolvePath = (rawPath: string, mode: 'read' | 'write' = 'read'): string => {
    const resolved = resolveToolPath(rawPath)
    if (!resolved) throw new Error('Excel 文件路径无效')
    assertExcelPath(resolved, mode)
    return resolved
  }

  const getWorkbook = async (
    sourcePath: string
  ): Promise<{ workbook: ExcelJS.Workbook; bytes: Buffer }> => {
    const cached = currentBytesByPath.get(sourcePath)
    const bytes = cached || (await readBytes(sourcePath))
    return { workbook: await loadWorkbook(bytes), bytes }
  }

  const read = async (args: ExcelReadInput): Promise<JsonObject> => {
    const sourcePath = resolvePath(args.sourcePath)
    const { workbook } = await getWorkbook(sourcePath)
    if (args.type === 'workbook') {
      return toJsonObject({
        sheets: workbook.worksheets.map((sheet) => ({
          name: sheet.name,
          range: usedRange(sheet),
          rowCount: sheet.actualRowCount,
          columnCount: sheet.actualColumnCount
        }))
      })
    }
    if (args.type === 'search') {
      const matcher = args.mode === 'regex' ? new RegExp(args.query, 'i') : null
      const isMatch = (value: string): boolean =>
        matcher ? matcher.test(value) : value.toLowerCase().includes(args.query.toLowerCase())
      const matches: Array<{
        sheetName: string
        address: string
        value?: string | number | boolean | null
        formula?: string
      }> = []
      let totalMatchCount = 0
      for (const sheet of workbook.worksheets) {
        if (args.sheetName && sheet.name !== args.sheetName) continue
        const maxRow = Math.max(sheet.rowCount, 1)
        const maxColumn = Math.max(sheet.columnCount, 1)
        for (let row = 1; row <= maxRow; row += 1) {
          for (let column = 1; column <= maxColumn; column += 1) {
            const cell = sheet.getCell(row, column)
            const formula = getFormula(cell.value)
            const matched = isMatch(cell.text) || isMatch(formula || '')
            if (!matched) continue
            totalMatchCount += 1
            if (matches.length < EXCEL_SEARCH_MAX_MATCHES) {
              matches.push(
                formula
                  ? { sheetName: sheet.name, address: cell.address, formula }
                  : {
                      sheetName: sheet.name,
                      address: cell.address,
                      value: serializeLiteral(cell.value, cell.text)
                    }
              )
            }
          }
        }
      }
      return toJsonObject({
        totalMatchCount,
        returnedMatchCount: matches.length,
        matches
      })
    }

    const sheet = requireSheet(workbook, args.sheetName)
    const range = parseRange(args.range)
    if (args.type === 'style') {
      return toJsonObject({
        sheetName: sheet.name,
        range: args.range,
        rows: readGrid(sheet, range, projectStyleCell)
      })
    }
    return toJsonObject({
      sheetName: sheet.name,
      range: args.range,
      rows: readGrid(sheet, range, projectRangeCell)
    })
  }

  const edit = async (args: ExcelEditInput): Promise<JsonObject> => {
    const sourcePath = resolvePath(args.sourcePath, 'write')
    const exists = await fs
      .stat(sourcePath)
      .then(() => true)
      .catch(() => false)
    const cachedBytes = currentBytesByPath.get(sourcePath)
    if (cachedBytes && exists) {
      const diskBytes = await readBytes(sourcePath)
      if (hashBytes(diskBytes) !== hashBytes(cachedBytes)) {
        currentBytesByPath.delete(sourcePath)
        throw new Error(`Excel 文件在操作期间发生变化，请重新读取后再编辑: ${args.sourcePath}`)
      }
    }
    const beforeBytes = cachedBytes || (exists ? await readBytes(sourcePath) : undefined)
    const workbook = beforeBytes ? await loadWorkbook(beforeBytes) : new ExcelJS.Workbook()
    const session = await input.ctx.getFileChangeSession(sourcePath)
    const sheetLineage = new Map<string, string | null>(
      session?.identity?.kind === 'excel'
        ? session.identity.sheets
        : workbook.worksheets.map((sheet) => [sheet.name, sheet.name])
    )
    const axes: ExcelSheetAxes[] =
      session?.identity?.kind === 'excel' ? structuredClone(session.identity.axes) : []
    for (const sheet of workbook.worksheets) {
      const bounds = sheetBounds(sheet)
      let axis = axes.find((item) => item.sheet === sheet.name)
      if (!axis) {
        axis = { sheet: sheet.name, rows: [], columns: [] }
        axes.push(axis)
      }
      extendAxis(axis.rows, bounds.rows)
      extendAxis(axis.columns, bounds.columns)
    }
    if ('sheetName' in args) {
      const axis = axes.find((item) => item.sheet === args.sheetName)
      if (axis) {
        if (args.type === 'rename_sheet') axis.sheet = args.newName
        else if (args.type === 'delete_sheet') axes.splice(axes.indexOf(axis), 1)
        else if (args.type === 'insert_rows' || args.type === 'delete_rows') {
          extendAxis(axis.rows, args.startRow + args.count)
          axis.rows.splice(
            args.startRow - 1,
            args.type === 'delete_rows' ? args.count : 0,
            ...Array.from({ length: args.type === 'insert_rows' ? args.count : 0 }, () => null)
          )
        } else if (args.type === 'insert_columns' || args.type === 'delete_columns') {
          const start = toColumnNumber(args.startColumn)
          extendAxis(axis.columns, start + args.count)
          axis.columns.splice(
            start - 1,
            args.type === 'delete_columns' ? args.count : 0,
            ...Array.from({ length: args.type === 'insert_columns' ? args.count : 0 }, () => null)
          )
        }
      }
    }
    applyOperation({ workbook, operation: args, sheetLineage })
    if (workbook.worksheets.length === 0) throw new Error('Excel 最终必须至少保留一个工作表')
    workbook.calcProperties.fullCalcOnLoad = true
    const afterBytes = Buffer.from(await workbook.xlsx.writeBuffer())
    try {
      await input.ctx.writeFileChange({
        sourcePath,
        buffer: afterBytes,
        capability: 'excel',
        expectedChecksum: beforeBytes ? hashBytes(beforeBytes) : undefined,
        identity: { kind: 'excel', sheets: [...sheetLineage], axes }
      })
      currentBytesByPath.set(sourcePath, afterBytes)
    } catch (error) {
      currentBytesByPath.delete(sourcePath)
      throw error
    }

    return toJsonObject({})
  }

  return { read, edit }
}

export const toExcelToolFailure = (sourcePath: string, error: unknown): JsonObject => ({
  sourcePath,
  error: error instanceof Error ? error.message : String(error)
})

export const materializeExcelReview = async (input: {
  before?: Buffer
  after: Buffer
  identity?: Extract<FileChangeIdentity, { kind: 'excel' }>
  reviewDir: string
}) => {
  const before = input.before ? await loadWorkbook(input.before) : null
  const after = await loadWorkbook(input.after)
  if (before) await calculateExcelFormulas(before)
  await calculateExcelFormulas(after)
  const sheets = new Map<string, string | null>(
    input.identity?.sheets ||
      after.worksheets.map((sheet) => [
        sheet.name,
        before?.getWorksheet(sheet.name) ? sheet.name : null
      ])
  )
  const result = await buildDiffWorkbook({
    before,
    after,
    sheetLineage: sheets,
    axes: input.identity?.axes
  })
  const previewPath = path.join(input.reviewDir, 'review.xlsx')
  await fs.writeFile(previewPath, result.bytes)
  await writeReviewIndex(
    input.reviewDir,
    input.after,
    result.changes.map((c, i) => ({
      id: `excel-${i + 1}`,
      surface: c.sheetName,
      key: c.address,
      target: c.target
    }))
  )
  return {
    changed: result.changes.length > 0,
    previewPath,
    changeCount: result.changes.length,
    insertCount: result.changes.filter((change) => change.kind !== 'deleted').length,
    deleteCount: result.changes.filter((change) => change.kind === 'deleted').length
  }
}

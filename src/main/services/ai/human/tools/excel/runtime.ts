import ExcelJS from 'exceljs'
import { diffArrays } from 'diff'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
import { isPathInsideRoot, resolveToolPath } from '../terminal/commandPolicy'
import { createToolEventEmitter } from '../utils/toolEvents'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { ExcelCapabilityToolsInput, ExcelRuntimeState, ExcelToolRuntime } from './types'
import type { ExcelEditInput, ExcelReadInput, ExcelStyle } from './toolSchemas'
import { EXCEL_SEARCH_MAX_MATCHES } from './constants'

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

const getStyleId = (cell: ExcelJS.Cell): number => {
  const candidate: unknown = cell
  if (!candidate || typeof candidate !== 'object' || !('styleId' in candidate)) return 0
  const value = (candidate as { styleId?: unknown }).styleId
  return typeof value === 'number' ? value : 0
}

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

const getFormulaResult = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || !('result' in value)) return undefined
  return (value as { result?: unknown }).result
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

const atomicReplace = async (sourcePath: string, bytes: Buffer): Promise<void> => {
  const tempPath = `${sourcePath}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, bytes)
  await fs.rename(tempPath, sourcePath).catch(async (error) => {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  })
}

const cellKey = (sheetName: string, address: string): string => `${sheetName}\u0000${address}`

const collectCellMap = (workbook: ExcelJS.Workbook): Map<string, ExcelJS.Cell> => {
  const cells = new Map<string, ExcelJS.Cell>()
  for (const sheet of workbook.worksheets) {
    const maxRow = Math.max(sheet.rowCount, 1)
    const maxColumn = Math.max(sheet.columnCount, 1)
    for (let row = 1; row <= maxRow; row += 1) {
      for (let column = 1; column <= maxColumn; column += 1) {
        const cell = sheet.getCell(row, column)
        if (
          (cell.value !== null && cell.value !== undefined && cell.value !== '') ||
          getStyleId(cell) > 0
        ) {
          cells.set(cellKey(sheet.name, cell.address), cell)
        }
      }
    }
  }
  return cells
}

const styleFingerprint = (cell: ExcelJS.Cell): string => JSON.stringify(cell.style || {})

type CellChange = { sheetName: string; address: string; kind: 'added' | 'modified' | 'deleted' }

type RowAlignment = {
  kind: 'equal' | 'modified' | 'inserted' | 'deleted'
  beforeRow?: number
  afterRow?: number
}

const compareWorkbooks = (
  before: ExcelJS.Workbook | null,
  after: ExcelJS.Workbook
): CellChange[] => {
  const beforeCells = before ? collectCellMap(before) : new Map<string, ExcelJS.Cell>()
  const afterCells = collectCellMap(after)
  const keys = new Set([...beforeCells.keys(), ...afterCells.keys()])
  const changes: CellChange[] = []
  for (const key of keys) {
    const beforeCell = beforeCells.get(key)
    const afterCell = afterCells.get(key)
    if (!beforeCell && afterCell) {
      const [sheetName, address] = key.split('\u0000')
      changes.push({ sheetName, address, kind: 'added' })
      continue
    }
    if (beforeCell && !afterCell) {
      const [sheetName, address] = key.split('\u0000')
      changes.push({ sheetName, address, kind: 'deleted' })
      continue
    }
    if (
      beforeCell &&
      afterCell &&
      (JSON.stringify(beforeCell.value) !== JSON.stringify(afterCell.value) ||
        styleFingerprint(beforeCell) !== styleFingerprint(afterCell))
    ) {
      const [sheetName, address] = key.split('\u0000')
      const beforeHasValue =
        beforeCell.value !== null && beforeCell.value !== undefined && beforeCell.value !== ''
      const afterHasValue =
        afterCell.value !== null && afterCell.value !== undefined && afterCell.value !== ''
      changes.push({
        sheetName,
        address,
        kind: beforeHasValue && !afterHasValue ? 'deleted' : 'modified'
      })
    }
  }
  return changes.sort((a, b) =>
    `${a.sheetName}!${a.address}`.localeCompare(`${b.sheetName}!${b.address}`)
  )
}

const mergeChanges = (changes: CellChange[], forced: CellChange[]): CellChange[] => {
  const merged = new Map<string, CellChange>()
  for (const change of [...changes, ...forced]) {
    const key = cellKey(change.sheetName, change.address)
    const existing = merged.get(key)
    if (!existing || change.kind === 'deleted') merged.set(key, change)
  }
  return Array.from(merged.values()).sort((left, right) =>
    `${left.sheetName}!${left.address}`.localeCompare(`${right.sheetName}!${right.address}`)
  )
}

const setBorder = (cell: ExcelJS.Cell, color: string): void => {
  const border = { style: 'medium' as const, color: { argb: color } }
  cell.style = {
    ...JSON.parse(JSON.stringify(cell.style || {})),
    border: { top: border, right: border, bottom: border, left: border }
  }
}

const cloneModel = <T>(value: T): T => structuredClone(value)

const cellFingerprint = (cell: ExcelJS.Cell): string =>
  JSON.stringify({ value: cell.value, style: cell.style || {} })

const rowSignature = (sheet: ExcelJS.Worksheet, rowNumber: number, maxColumn: number): string => {
  const row = sheet.getRow(rowNumber)
  const payload = {
    height: row.height || null,
    hidden: row.hidden,
    outlineLevel: row.outlineLevel,
    cells: Array.from({ length: maxColumn }, (_, index) => cellFingerprint(row.getCell(index + 1)))
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

const rowSimilarity = (
  before: ExcelJS.Worksheet,
  beforeRow: number,
  after: ExcelJS.Worksheet,
  afterRow: number,
  maxColumn: number
): number => {
  if (maxColumn <= 0) return 0
  let equalCells = 0
  for (let column = 1; column <= maxColumn; column += 1) {
    if (
      cellFingerprint(before.getCell(beforeRow, column)) ===
      cellFingerprint(after.getCell(afterRow, column))
    ) {
      equalCells += 1
    }
  }
  return equalCells / maxColumn
}

const alignChangedRows = (input: {
  before: ExcelJS.Worksheet
  after: ExcelJS.Worksheet
  beforeRows: number[]
  afterRows: number[]
  maxColumn: number
}): RowAlignment[] => {
  const { beforeRows, afterRows } = input
  if (beforeRows.length === 0) {
    return afterRows.map((afterRow) => ({ kind: 'inserted', afterRow }))
  }
  if (afterRows.length === 0) {
    return beforeRows.map((beforeRow) => ({ kind: 'deleted', beforeRow }))
  }
  if (beforeRows.length === afterRows.length || beforeRows.length * afterRows.length > 10_000) {
    const paired = Math.min(beforeRows.length, afterRows.length)
    return [
      ...Array.from({ length: paired }, (_, index) => ({
        kind: 'modified' as const,
        beforeRow: beforeRows[index],
        afterRow: afterRows[index]
      })),
      ...beforeRows.slice(paired).map((beforeRow) => ({ kind: 'deleted' as const, beforeRow })),
      ...afterRows.slice(paired).map((afterRow) => ({ kind: 'inserted' as const, afterRow }))
    ]
  }

  const rows = beforeRows.length
  const columns = afterRows.length
  const costs = Array.from({ length: rows + 1 }, () => Array<number>(columns + 1).fill(0))
  const moves = Array.from({ length: rows + 1 }, () =>
    Array<'pair' | 'delete' | 'insert' | null>(columns + 1).fill(null)
  )
  for (let row = 1; row <= rows; row += 1) {
    costs[row][0] = row
    moves[row][0] = 'delete'
  }
  for (let column = 1; column <= columns; column += 1) {
    costs[0][column] = column
    moves[0][column] = 'insert'
  }
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const similarity = rowSimilarity(
        input.before,
        beforeRows[row - 1],
        input.after,
        afterRows[column - 1],
        input.maxColumn
      )
      const pairCost = costs[row - 1][column - 1] + 1 - similarity * 0.5
      const deleteCost = costs[row - 1][column] + 1
      const insertCost = costs[row][column - 1] + 1
      if (pairCost <= deleteCost && pairCost <= insertCost) {
        costs[row][column] = pairCost
        moves[row][column] = 'pair'
      } else if (deleteCost <= insertCost) {
        costs[row][column] = deleteCost
        moves[row][column] = 'delete'
      } else {
        costs[row][column] = insertCost
        moves[row][column] = 'insert'
      }
    }
  }

  const reversed: RowAlignment[] = []
  let row = rows
  let column = columns
  while (row > 0 || column > 0) {
    const move = moves[row][column]
    if (move === 'pair') {
      reversed.push({
        kind: 'modified',
        beforeRow: beforeRows[row - 1],
        afterRow: afterRows[column - 1]
      })
      row -= 1
      column -= 1
    } else if (move === 'delete') {
      reversed.push({ kind: 'deleted', beforeRow: beforeRows[row - 1] })
      row -= 1
    } else {
      reversed.push({ kind: 'inserted', afterRow: afterRows[column - 1] })
      column -= 1
    }
  }
  return reversed.reverse()
}

const isTrailingEmptyRow = (
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  maxColumn: number
): boolean => {
  const row = sheet.getRow(rowNumber)
  if (row.height || row.hidden || row.outlineLevel) return false
  for (let column = 1; column <= maxColumn; column += 1) {
    const cell = row.getCell(column)
    if (cell.value !== null && cell.value !== undefined && cell.value !== '') return false
    if (getStyleId(cell) > 0 || JSON.stringify(cell.style || {}) !== '{}') return false
  }
  return true
}

const alignWorksheetRows = (
  before: ExcelJS.Worksheet,
  after: ExcelJS.Worksheet
): RowAlignment[] => {
  const maxColumn = Math.max(before.columnCount, after.columnCount, 1)
  const beforeRows = Array.from({ length: before.rowCount }, (_, index) => index + 1)
  const afterRows = Array.from({ length: after.rowCount }, (_, index) => index + 1)
  while (beforeRows.length > 0 && isTrailingEmptyRow(before, beforeRows[beforeRows.length - 1], maxColumn)) {
    beforeRows.pop()
  }
  while (afterRows.length > 0 && isTrailingEmptyRow(after, afterRows[afterRows.length - 1], maxColumn)) {
    afterRows.pop()
  }
  const beforeSignatures = beforeRows.map((row) => rowSignature(before, row, maxColumn))
  const afterSignatures = afterRows.map((row) => rowSignature(after, row, maxColumn))
  const alignment: RowAlignment[] = []
  let beforeOffset = 0
  let afterOffset = 0
  let pendingBefore: number[] = []
  let pendingAfter: number[] = []
  const flushPending = (): void => {
    alignment.push(
      ...alignChangedRows({
        before,
        after,
        beforeRows: pendingBefore,
        afterRows: pendingAfter,
        maxColumn
      })
    )
    pendingBefore = []
    pendingAfter = []
  }

  for (const part of diffArrays(beforeSignatures, afterSignatures)) {
    if (part.removed) {
      pendingBefore.push(
        ...Array.from({ length: part.count || 0 }, (_, index) => beforeOffset + index + 1)
      )
      beforeOffset += part.count || 0
      continue
    }
    if (part.added) {
      pendingAfter.push(
        ...Array.from({ length: part.count || 0 }, (_, index) => afterOffset + index + 1)
      )
      afterOffset += part.count || 0
      continue
    }
    flushPending()
    for (let index = 0; index < (part.count || 0); index += 1) {
      alignment.push({
        kind: 'equal',
        beforeRow: beforeOffset + index + 1,
        afterRow: afterOffset + index + 1
      })
    }
    beforeOffset += part.count || 0
    afterOffset += part.count || 0
  }
  flushPending()
  return alignment
}

const copyRow = (source: ExcelJS.Row, target: ExcelJS.Row, maxColumn: number): void => {
  target.height = source.height
  target.hidden = source.hidden
  target.outlineLevel = source.outlineLevel
  for (let column = 1; column <= maxColumn; column += 1) {
    const sourceCell = source.getCell(column)
    const targetCell = target.getCell(column)
    targetCell.value = cloneModel(sourceCell.value) as ExcelJS.CellValue
    targetCell.style = cloneModel(sourceCell.style || {})
    targetCell.dataValidation = cloneModel(sourceCell.dataValidation || {})
    if (sourceCell.note) targetCell.note = cloneModel(sourceCell.note)
  }
}

const sheetUsedBounds = (
  sheet: ExcelJS.Worksheet
): { top: number; left: number; bottom: number; right: number } => {
  if (sheet.actualRowCount === 0 || sheet.actualColumnCount === 0) {
    return { top: 1, left: 1, bottom: 1, right: 1 }
  }
  const dimensions = sheet.dimensions
  return {
    top: dimensions.top,
    left: dimensions.left,
    bottom: dimensions.bottom,
    right: dimensions.right
  }
}

const setUsedRangeBorder = (sheet: ExcelJS.Worksheet, color: string): void => {
  const bounds = sheetUsedBounds(sheet)
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      setBorder(sheet.getCell(row, column), color)
    }
  }
}

type WorksheetModelWithInternals = ExcelJS.WorksheetModel & {
  mergeCells?: string[]
  merges?: string[]
  rows?: unknown[]
  cols?: unknown[]
  state?: ExcelJS.WorksheetState
}

type WorkbookInternalModel = Omit<ExcelJS.WorkbookModel, 'worksheets' | 'sheets'> & {
  worksheets: WorksheetModelWithInternals[]
  sheets: WorksheetModelWithInternals[]
}

const cloneWorksheetModel = (sheet: ExcelJS.Worksheet, id: number): WorksheetModelWithInternals => {
  const model = cloneModel(sheet.model) as WorksheetModelWithInternals
  model.id = id
  model.name = sheet.name
  model.state = sheet.state
  model.mergeCells = cloneModel(model.merges || model.mergeCells || [])
  return model
}

const buildDiffBaseWorkbook = (
  before: ExcelJS.Workbook | null,
  after: ExcelJS.Workbook,
  sheetLineage: ReadonlyMap<string, string | null>
): ExcelJS.Workbook => {
  const afterSheets = new Map(after.worksheets.map((sheet) => [sheet.name, sheet]))
  const afterNameByBaselineName = new Map<string, string>()
  sheetLineage.forEach((baselineName, afterName) => {
    if (baselineName) afterNameByBaselineName.set(baselineName, afterName)
  })
  const orderedSheets: Array<{ outputName: string; source: ExcelJS.Worksheet }> = []
  for (const sheet of before?.worksheets || []) {
    const afterName = afterNameByBaselineName.get(sheet.name)
    const afterSheet = afterName ? afterSheets.get(afterName) : undefined
    orderedSheets.push({ outputName: afterName || sheet.name, source: afterSheet || sheet })
  }
  for (const sheet of after.worksheets) {
    if (sheetLineage.get(sheet.name) === null) {
      orderedSheets.push({ outputName: sheet.name, source: sheet })
    }
  }

  const diffWorkbook = new ExcelJS.Workbook()
  const baseModel = cloneModel(after.model) as ExcelJS.WorkbookModel
  const worksheets = orderedSheets.map((entry, index) => {
    const model = cloneWorksheetModel(entry.source, index + 1)
    model.name = entry.outputName
    return model
  })
  const workbookModel = { ...baseModel }
  const diffModel: WorkbookInternalModel = {
    ...workbookModel,
    worksheets,
    sheets: worksheets
  }
  Reflect.set(diffWorkbook, 'model', diffModel)
  return diffWorkbook
}

const buildDiffWorkbook = async (input: {
  before: ExcelJS.Workbook | null
  after: ExcelJS.Workbook
  sheetLineage: ReadonlyMap<string, string | null>
}): Promise<{ bytes: Buffer; changes: CellChange[] }> => {
  const diffWorkbook = buildDiffBaseWorkbook(input.before, input.after, input.sheetLineage)
  const beforeSheetNames = new Set(input.before?.worksheets.map((sheet) => sheet.name) || [])
  const changes: CellChange[] = []
  const afterNameByBaselineName = new Map<string, string>()
  input.sheetLineage.forEach((baselineName, afterName) => {
    if (baselineName) afterNameByBaselineName.set(baselineName, afterName)
  })

  for (const sheetName of beforeSheetNames) {
    if (afterNameByBaselineName.has(sheetName)) continue
    const sheet = diffWorkbook.getWorksheet(sheetName)
    if (!sheet) continue
    sheet.properties.tabColor = { argb: RED }
    setUsedRangeBorder(sheet, RED)
    const bounds = sheetUsedBounds(sheet)
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        changes.push({ sheetName, address: sheet.getCell(row, column).address, kind: 'deleted' })
      }
    }
  }

  for (const [sheetName, baselineName] of input.sheetLineage) {
    if (baselineName !== null) continue
    const sheet = diffWorkbook.getWorksheet(sheetName)
    if (!sheet) continue
    sheet.properties.tabColor = { argb: GREEN }
    setUsedRangeBorder(sheet, GREEN)
    const bounds = sheetUsedBounds(sheet)
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        changes.push({ sheetName, address: sheet.getCell(row, column).address, kind: 'added' })
      }
    }
  }

  for (const beforeSheetName of beforeSheetNames) {
    const afterSheetName = afterNameByBaselineName.get(beforeSheetName)
    if (!afterSheetName) continue
    const beforeSheet = input.before?.getWorksheet(beforeSheetName)
    const afterSheet = input.after.getWorksheet(afterSheetName)
    const diffSheet = diffWorkbook.getWorksheet(afterSheetName)
    if (!beforeSheet || !afterSheet || !diffSheet) continue
    if (beforeSheetName !== afterSheetName) {
      diffSheet.properties.tabColor = { argb: GREEN }
    }
    const alignment = alignWorksheetRows(beforeSheet, afterSheet)
    let outputRow = 1
    for (const entry of alignment) {
      if (entry.kind === 'deleted') diffSheet.spliceRows(outputRow, 0, [])
      outputRow += 1
    }

    const maxColumn = Math.max(beforeSheet.columnCount, afterSheet.columnCount, 1)
    outputRow = 1
    for (const entry of alignment) {
      const sourceRow =
        entry.kind === 'deleted'
          ? beforeSheet.getRow(entry.beforeRow!)
          : afterSheet.getRow(entry.afterRow!)
      copyRow(sourceRow, diffSheet.getRow(outputRow), maxColumn)

      if (entry.kind === 'deleted' || entry.kind === 'inserted') {
        const kind = entry.kind === 'deleted' ? 'deleted' : 'added'
        const color = entry.kind === 'deleted' ? RED : GREEN
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = diffSheet.getCell(outputRow, column)
          setBorder(cell, color)
          changes.push({ sheetName: afterSheetName, address: cell.address, kind })
        }
        outputRow += 1
        continue
      }

      if (entry.kind === 'modified') {
        let rowHasCellChange = false
        for (let column = 1; column <= maxColumn; column += 1) {
          const beforeCell = beforeSheet.getCell(entry.beforeRow!, column)
          const afterCell = afterSheet.getCell(entry.afterRow!, column)
          if (cellFingerprint(beforeCell) === cellFingerprint(afterCell)) continue
          const diffCell = diffSheet.getCell(outputRow, column)
          const beforeHasValue =
            beforeCell.value !== null && beforeCell.value !== undefined && beforeCell.value !== ''
          const afterHasValue =
            afterCell.value !== null && afterCell.value !== undefined && afterCell.value !== ''
          const kind = beforeHasValue && !afterHasValue ? 'deleted' : 'modified'
          if (kind === 'deleted') {
            diffCell.value = cloneModel(beforeCell.value) as ExcelJS.CellValue
            diffCell.style = cloneModel(beforeCell.style || {})
          }
          setBorder(diffCell, kind === 'deleted' ? RED : GREEN)
          changes.push({ sheetName: afterSheetName, address: diffCell.address, kind })
          rowHasCellChange = true
        }
        const beforeRow = beforeSheet.getRow(entry.beforeRow!)
        const afterRow = afterSheet.getRow(entry.afterRow!)
        if (
          !rowHasCellChange &&
          (beforeRow.height !== afterRow.height ||
            beforeRow.hidden !== afterRow.hidden ||
            beforeRow.outlineLevel !== afterRow.outlineLevel)
        ) {
          const markerCell = diffSheet.getCell(outputRow, 1)
          setBorder(markerCell, GREEN)
          changes.push({ sheetName: afterSheetName, address: markerCell.address, kind: 'modified' })
        }
      }
      outputRow += 1
    }

    const maxLayoutColumn = Math.max(beforeSheet.columnCount, afterSheet.columnCount, 1)
    for (let column = 1; column <= maxLayoutColumn; column += 1) {
      if (beforeSheet.getColumn(column).width === afterSheet.getColumn(column).width) continue
      const markerCell = diffSheet.getCell(1, column)
      if (
        !changes.some(
          (change) => change.sheetName === afterSheetName && change.address === markerCell.address
        )
      ) {
        setBorder(markerCell, GREEN)
        changes.push({ sheetName: afterSheetName, address: markerCell.address, kind: 'modified' })
      }
    }
  }
  const bytes = await diffWorkbook.xlsx.writeBuffer()
  return { bytes: Buffer.from(bytes), changes }
}

const applyStyle = (cell: ExcelJS.Cell, style: ExcelStyle | undefined): void => {
  if (!style) return
  const currentFont = cell.font || {}
  if (typeof style.bold === 'boolean' || typeof style.italic === 'boolean' || style.fontColor) {
    cell.font = {
      ...currentFont,
      bold: typeof style.bold === 'boolean' ? style.bold : currentFont.bold,
      italic: typeof style.italic === 'boolean' ? style.italic : currentFont.italic,
      color: style.fontColor
        ? { argb: String(style.fontColor).replace(/^#/, '') }
        : currentFont.color
    }
  }
  if (style.fillColor)
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: String(style.fillColor).replace(/^#/, '') }
    }
  if (style.numberFormat) cell.numFmt = String(style.numberFormat)
  if (style.horizontalAlignment || style.verticalAlignment) {
    const currentAlignment = cell.alignment || {}
    cell.alignment = {
      ...currentAlignment,
      horizontal: style.horizontalAlignment as ExcelJS.Alignment['horizontal'],
      vertical: style.verticalAlignment as ExcelJS.Alignment['vertical']
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

const serializeLiteral = (value: unknown, fallbackText: string): string | number | boolean | null => {
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

const projectRangeCell = (cell: ExcelJS.Cell): string | number | boolean | null | { formula: string; value?: string | number | boolean | null } => {
  const formula = getFormula(cell.value)
  if (formula) {
    const result = getFormulaResult(cell.value)
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
  const style: { bold?: boolean; fontColor?: string; fillColor?: string; numberFormat?: string } = {}
  if (cell.font?.bold) style.bold = true
  const fontColor = cell.font?.color?.argb
  if (fontColor) style.fontColor = fontColor
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.fgColor?.argb) style.fillColor = fill.fgColor.argb
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
  forcedChanges: CellChange[]
}): void => {
  const { workbook, operation, sheetLineage, forcedChanges } = input
  if (operation.type === 'add_sheet') {
    if (workbook.getWorksheet(operation.sheetName))
      throw new Error(`工作表已存在: ${operation.sheetName}`)
    workbook.addWorksheet(operation.sheetName)
    sheetLineage.set(operation.sheetName, null)
    forcedChanges.push({ sheetName: operation.sheetName, address: 'A1', kind: 'added' })
    return
  }
  if (operation.type === 'delete_sheet') {
    const sheet = requireSheet(workbook, operation.sheetName)
    if (workbook.worksheets.length === 1) throw new Error('Excel 最终必须至少保留一个工作表')
    workbook.removeWorksheet(sheet.id)
    sheetLineage.delete(sheet.name)
    forcedChanges.push({ sheetName: sheet.name, address: 'A1', kind: 'deleted' })
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
    forcedChanges.push(
      { sheetName: previousName, address: 'A1', kind: 'deleted' },
      { sheetName: sheet.name, address: 'A1', kind: 'added' }
    )
    return
  }

  const sheet = requireSheet(workbook, operation.sheetName)
  if (operation.type === 'set_range') {
    const range = parseRange(operation.range)
    const expectedRows = range.bottom - range.top + 1
    const expectedColumns = range.right - range.left + 1
    const rowCount = operation.values.length
    if (rowCount !== expectedRows || operation.values.some((row) => row.length !== expectedColumns)) {
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
    const firstCell = sheet.getCell(operation.range.split(':')[0])
    const wasMerged = firstCell.isMerged
    sheet.mergeCells(operation.range)
    if (!wasMerged)
      forcedChanges.push({ sheetName: sheet.name, address: firstCell.address, kind: 'modified' })
    return
  }
  if (operation.type === 'unmerge_cells') {
    const firstCell = sheet.getCell(operation.range.split(':')[0])
    if (!firstCell.isMerged) return
    sheet.unMergeCells(operation.range)
    forcedChanges.push({ sheetName: sheet.name, address: firstCell.address, kind: 'modified' })
    return
  }
  if (operation.type === 'insert_rows') {
    sheet.spliceRows(operation.startRow, 0, ...Array.from({ length: operation.count }, () => []))
    return
  }
  if (operation.type === 'delete_rows') {
    sheet.spliceRows(operation.startRow, operation.count)
    return
  }
  if (operation.type === 'insert_columns') {
    const startColumn = toColumnNumber(operation.startColumn)
    sheet.spliceColumns(startColumn, 0, ...Array.from({ length: operation.count }, () => []))
    return
  }
  if (operation.type === 'delete_columns') {
    sheet.spliceColumns(toColumnNumber(operation.startColumn), operation.count)
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
    const targetColumn = sheet.getColumn(operation.column)
    const previousWidth = targetColumn.width
    targetColumn.width = operation.width
    const column =
      typeof operation.column === 'number'
        ? columnLetters(operation.column)
        : String(operation.column).toUpperCase()
    if (previousWidth !== targetColumn.width)
      forcedChanges.push({ sheetName: sheet.name, address: `${column}1`, kind: 'modified' })
    return
  }
  if (operation.type === 'set_row_height') {
    const row = sheet.getRow(operation.row)
    const previousHeight = row.height
    row.height = operation.height
    if (previousHeight !== row.height)
      forcedChanges.push({
        sheetName: sheet.name,
        address: `A${String(operation.row)}`,
        kind: 'modified'
      })
    return
  }
  const range = parseRange(operation.range)
  for (let column = range.left; column <= range.right; column += 1) {
    let maxLength = 8
    for (let row = range.top; row <= range.bottom; row += 1) {
      const text = sheet.getCell(row, column).text || ''
      maxLength = Math.max(maxLength, Array.from(text).length + 2)
    }
    const targetColumn = sheet.getColumn(column)
    const previousWidth = targetColumn.width
    targetColumn.width = Math.min(maxLength, 60)
    if (previousWidth !== targetColumn.width) {
      forcedChanges.push({
        sheetName: sheet.name,
        address: `${columnLetters(column)}1`,
        kind: 'modified'
      })
    }
  }
}

export const createExcelToolRuntime = (input: ExcelCapabilityToolsInput): ExcelToolRuntime => {
  const state: ExcelRuntimeState = {
    toolEvents: createToolEventEmitter({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId
    }),
    recordsByPath: new Map(),
    baselineBytesByPath: new Map(),
    currentBytesByPath: new Map(),
    sheetLineageByPath: new Map()
  }
  const resolvePath = (rawPath: string, mode: 'read' | 'write' = 'read'): string => {
    const resolved = resolveToolPath(rawPath)
    if (!resolved) throw new Error('Excel 文件路径无效')
    assertExcelPath(resolved, mode)
    return resolved
  }

  const getWorkbook = async (
    sourcePath: string
  ): Promise<{ workbook: ExcelJS.Workbook; bytes: Buffer }> => {
    const cached = state.currentBytesByPath.get(sourcePath)
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
            matches.push(
              formula
                ? { sheetName: sheet.name, address: cell.address, formula }
                : {
                    sheetName: sheet.name,
                    address: cell.address,
                    value: serializeLiteral(cell.value, cell.text)
                  }
            )
            if (matches.length >= EXCEL_SEARCH_MAX_MATCHES) {
              return toJsonObject({ truncated: true, matches })
            }
          }
        }
      }
      return toJsonObject({ truncated: false, matches })
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
    const cachedBytes = state.currentBytesByPath.get(sourcePath)
    if (cachedBytes && exists) {
      const diskBytes = await readBytes(sourcePath)
      if (hashBytes(diskBytes) !== hashBytes(cachedBytes)) {
        throw new Error(`Excel 文件在操作期间发生变化，请重新读取后再编辑: ${args.sourcePath}`)
      }
    }
    const beforeBytes = cachedBytes || (exists ? await readBytes(sourcePath) : undefined)
    if (!state.baselineBytesByPath.has(sourcePath))
      state.baselineBytesByPath.set(sourcePath, beforeBytes)
    const workbook = beforeBytes ? await loadWorkbook(beforeBytes) : new ExcelJS.Workbook()
    const sheetLineage = new Map(
      state.sheetLineageByPath.get(sourcePath) ||
        workbook.worksheets.map((sheet) => [sheet.name, sheet.name] as const)
    )
    const forcedChanges: CellChange[] = []
    applyOperation({ workbook, operation: args, sheetLineage, forcedChanges })
    if (workbook.worksheets.length === 0) throw new Error('Excel 最终必须至少保留一个工作表')
    workbook.calcProperties.fullCalcOnLoad = true
    const afterBytes = Buffer.from(await workbook.xlsx.writeBuffer())
    const beforeWorkbook = beforeBytes ? await loadWorkbook(beforeBytes) : null
    const afterWorkbook = await loadWorkbook(afterBytes)
    const operationChanges = mergeChanges(
      compareWorkbooks(beforeWorkbook, afterWorkbook),
      forcedChanges
    )
    if (operationChanges.length === 0) return toJsonObject({})
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    if (!isPathInsideRoot(sourcePath, input.workspaceRootPath)) {
      await atomicReplace(sourcePath, afterBytes)
      state.currentBytesByPath.set(sourcePath, afterBytes)
      state.sheetLineageByPath.set(sourcePath, sheetLineage)
      return toJsonObject({})
    }
    const baseline = state.baselineBytesByPath.get(sourcePath)
    const baselineWorkbook = baseline ? await loadWorkbook(baseline) : null
    const diffResult = await buildDiffWorkbook({
      before: baselineWorkbook,
      after: afterWorkbook,
      sheetLineage
    })
    const cumulativeChanges = diffResult.changes
    const changeId = state.recordsByPath.get(sourcePath)?.id || randomUUID()
    const snapshotRoot = path.join(
      input.workspaceRootPath,
      '.ncurator',
      'file-changes',
      input.runId
    )
    await fs.mkdir(snapshotRoot, { recursive: true })
    const beforeSnapshotPath = baseline
      ? path.join(snapshotRoot, `${changeId}-${path.basename(sourcePath)}`)
      : undefined
    if (baseline && beforeSnapshotPath) await fs.writeFile(beforeSnapshotPath, baseline)
    const previewPath = path.join(snapshotRoot, `${changeId}-${randomUUID()}.diff.xlsx`)
    await fs.writeFile(previewPath, diffResult.bytes)
    await atomicReplace(sourcePath, afterBytes)
    const now = Date.now()
    const record = {
      id: changeId,
      sessionId: input.sessionId,
      runId: input.runId,
      status: 'applied' as const,
      capability: 'excel' as const,
      path: sourcePath,
      fileName: path.basename(sourcePath),
      operation: baseline ? ('updated' as const) : ('created' as const),
      source: 'excel_tool' as const,
      beforePath: baseline ? sourcePath : undefined,
      afterPath: sourcePath,
      changeCount: cumulativeChanges.length,
      insertCount: cumulativeChanges.filter((item) => item.kind !== 'deleted').length,
      deleteCount: cumulativeChanges.filter((item) => item.kind === 'deleted').length,
      beforeSnapshotPath,
      afterSnapshotPath: undefined,
      beforeChecksum: baseline ? hashBytes(baseline) : undefined,
      afterChecksum: hashBytes(afterBytes),
      previewPath,
      runSummary: 'Excel 文件修改',
      createdAt: state.recordsByPath.get(sourcePath)?.createdAt || now,
      updatedAt: now
    }
    try {
      await input.ctx.saveFileChangeRecord(record)
    } catch (error) {
      if (beforeBytes) await atomicReplace(sourcePath, beforeBytes).catch(() => undefined)
      else await fs.rm(sourcePath, { force: true }).catch(() => undefined)
      await fs.rm(previewPath, { force: true }).catch(() => undefined)
      if (beforeSnapshotPath)
        await fs.rm(beforeSnapshotPath, { force: true }).catch(() => undefined)
      throw error
    }
    state.currentBytesByPath.set(sourcePath, afterBytes)
    state.recordsByPath.set(sourcePath, record)
    state.sheetLineageByPath.set(sourcePath, sheetLineage)
    emitFileArtifactEvent({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      capability: 'excel',
      artifactPath: sourcePath,
      operation: record.operation,
      applyId: record.id,
      changeCount: record.changeCount,
      insertCount: record.insertCount,
      deleteCount: record.deleteCount
    })
    return toJsonObject({})
  }

  return { read, edit }
}

export const toExcelToolFailure = (sourcePath: string, error: unknown): JsonObject => ({
  ok: false,
  sourcePath,
  error: error instanceof Error ? error.message : String(error)
})

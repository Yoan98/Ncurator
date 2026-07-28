import ExcelJS from 'exceljs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { JsonObject } from '../../../../../../shared/types'
import { resolveWorkspacePath } from '../terminal/commandPolicy'
import { createToolEventEmitter } from '../utils/toolEvents'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { ExcelCapabilityToolsInput, ExcelRuntimeState, ExcelToolRuntime } from './types'
import type { ExcelEditInput } from './schemas'

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

const getTableNames = (sheet: ExcelJS.Worksheet): string[] => {
  const candidate: unknown = sheet
  if (!candidate || typeof candidate !== 'object' || !('tables' in candidate)) return []
  const tables = (candidate as { tables?: unknown }).tables
  return tables && typeof tables === 'object' ? Object.keys(tables) : []
}

const getTableColumns = (table: ExcelJS.Table): Array<{ name: string }> => {
  const candidate: unknown = table
  if (!candidate || typeof candidate !== 'object' || !('table' in candidate)) return []
  const model = (candidate as { table?: { columns?: unknown } }).table
  if (!model || !Array.isArray(model.columns)) return []
  return model.columns.filter((column): column is { name: string } =>
    Boolean(
      column &&
      typeof column === 'object' &&
      typeof (column as { name?: unknown }).name === 'string'
    )
  )
}

const getFormula = (value: unknown): string | undefined =>
  value && typeof value === 'object' && 'formula' in value
    ? String((value as { formula?: unknown }).formula || '') || undefined
    : undefined

const getCellType = (cell: ExcelJS.Cell): string => {
  if (getFormula(cell.value)) return 'formula'
  if (cell.value === null || cell.value === undefined || cell.value === '') return 'blank'
  if (typeof cell.value === 'number') return 'number'
  if (typeof cell.value === 'boolean') return 'boolean'
  if (cell.value instanceof Date) return 'date'
  return 'text'
}

const getCellSnapshot = (cell: ExcelJS.Cell) => ({
  address: cell.address,
  value: cell.value,
  displayValue: cell.text,
  formula: getFormula(cell.value),
  type: getCellType(cell),
  numberFormat: cell.numFmt || undefined
})

const usedRange = (sheet: ExcelJS.Worksheet): string | null => {
  if (sheet.actualRowCount === 0 || sheet.actualColumnCount === 0) return null
  return `A1:${sheet.getCell(sheet.rowCount, sheet.columnCount).address}`
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
      changes.push({ sheetName, address, kind: 'modified' })
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
  const border = { style: 'thin' as const, color: { argb: color } }
  cell.style = {
    ...JSON.parse(JSON.stringify(cell.style || {})),
    border: { top: border, right: border, bottom: border, left: border }
  }
}

const buildDiffWorkbook = async (input: {
  before: ExcelJS.Workbook | null
  after: ExcelJS.Workbook
  changes: CellChange[]
}): Promise<Buffer> => {
  const afterBytes = await input.after.xlsx.writeBuffer()
  const diffWorkbook = await loadWorkbook(Buffer.from(afterBytes))
  const beforeCells = input.before ? collectCellMap(input.before) : new Map<string, ExcelJS.Cell>()
  for (const change of input.changes) {
    const sheet =
      diffWorkbook.getWorksheet(change.sheetName) || diffWorkbook.addWorksheet(change.sheetName)
    if (change.address === 'A1' && change.kind === 'deleted') {
      sheet.properties.tabColor = { argb: RED }
    } else if (change.address === 'A1' && change.kind === 'added') {
      sheet.properties.tabColor = { argb: GREEN }
    }
    const cell = sheet.getCell(change.address)
    if (change.kind === 'deleted') {
      const beforeCell = beforeCells.get(cellKey(change.sheetName, change.address))
      if (beforeCell) {
        cell.value = beforeCell.value as ExcelJS.CellValue
        cell.style = JSON.parse(JSON.stringify(beforeCell.style || {}))
      }
    }
    setBorder(cell, change.kind === 'deleted' ? RED : GREEN)
  }
  const bytes = await diffWorkbook.xlsx.writeBuffer()
  return Buffer.from(bytes)
}

const applyStyle = (cell: ExcelJS.Cell, style: Record<string, unknown> | undefined): void => {
  if (!style) return
  if (typeof style.bold === 'boolean' || typeof style.italic === 'boolean' || style.fontColor) {
    cell.font = {
      ...cell.font,
      bold: typeof style.bold === 'boolean' ? style.bold : cell.font.bold,
      italic: typeof style.italic === 'boolean' ? style.italic : cell.font.italic,
      color: style.fontColor ? { argb: String(style.fontColor).replace(/^#/, '') } : cell.font.color
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
    cell.alignment = {
      ...cell.alignment,
      horizontal: style.horizontalAlignment as ExcelJS.Alignment['horizontal'],
      vertical: style.verticalAlignment as ExcelJS.Alignment['vertical']
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
    currentBytesByPath: new Map()
  }
  const resolvePath = (rawPath: string, mode: 'read' | 'write' = 'read'): string => {
    const resolved = resolveWorkspacePath({
      rawPath,
      cwd: input.workspaceRootPath,
      rootPath: input.workspaceRootPath
    })
    if (!resolved) throw new Error('Excel 文件必须位于当前工作区内')
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

  const outline = async (args: { sourcePath: string }): Promise<JsonObject> => {
    const sourcePath = resolvePath(args.sourcePath)
    const { workbook } = await getWorkbook(sourcePath)
    const sheets = workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      index: workbook.worksheets.indexOf(sheet),
      range: usedRange(sheet),
      rowCount: sheet.actualRowCount,
      columnCount: sheet.actualColumnCount,
      formulaCount: collectCellMap(workbook).size
        ? Array.from(collectCellMap(workbook).values()).filter(
            (cell) => cell.worksheet.name === sheet.name && Boolean(getFormula(cell.value))
          ).length
        : 0,
      tables: getTableNames(sheet)
    }))
    return toJsonObject({ sourcePath, sheetCount: sheets.length, sheets })
  }

  const search = async (args: {
    sourcePath: string
    query: string
    mode?: 'literal' | 'regex'
    scope?: { sheetNames?: string[] }
  }): Promise<JsonObject> => {
    const sourcePath = resolvePath(args.sourcePath)
    const { workbook } = await getWorkbook(sourcePath)
    const matcher = args.mode === 'regex' ? new RegExp(args.query, 'i') : null
    const isMatch = (value: string): boolean =>
      matcher ? matcher.test(value) : value.toLowerCase().includes(args.query.toLowerCase())
    const names = args.scope?.sheetNames ? new Set(args.scope.sheetNames) : null
    const matches: JsonObject[] = []
    for (const sheet of workbook.worksheets) {
      if (names && !names.has(sheet.name)) continue
      if (isMatch(sheet.name)) {
        matches.push(toJsonObject({ matchType: 'sheet_name', sheetName: sheet.name }))
      }
      for (const tableName of getTableNames(sheet)) {
        const table = sheet.getTable(tableName)
        if (isMatch(tableName)) {
          matches.push(toJsonObject({ matchType: 'table_name', sheetName: sheet.name, tableName }))
        }
        for (const column of getTableColumns(table)) {
          if (isMatch(column.name)) {
            matches.push(
              toJsonObject({
                matchType: 'table_column',
                sheetName: sheet.name,
                tableName,
                columnName: column.name
              })
            )
          }
        }
      }
      const maxRow = Math.max(sheet.rowCount, 1)
      const maxColumn = Math.max(sheet.columnCount, 1)
      for (let row = 1; row <= maxRow; row += 1) {
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = sheet.getCell(row, column)
          const matched = isMatch(cell.text) || isMatch(getFormula(cell.value) || '')
          if (!matched) continue
          matches.push(toJsonObject({ sheetName: sheet.name, ...getCellSnapshot(cell) }))
          if (matches.length >= 500)
            return toJsonObject({ sourcePath, query: args.query, matches, truncated: true })
        }
      }
    }
    return toJsonObject({ sourcePath, query: args.query, matches, truncated: false })
  }

  const readCells = async (args: {
    sourcePath: string
    ranges: Array<{ sheetName: string; range: string }>
  }): Promise<JsonObject> => {
    const sourcePath = resolvePath(args.sourcePath)
    const { workbook } = await getWorkbook(sourcePath)
    const results: JsonObject[] = []
    for (const request of args.ranges) {
      const sheet = workbook.getWorksheet(request.sheetName)
      if (!sheet) throw new Error(`工作表不存在: ${request.sheetName}`)
      const range = parseRange(request.range)
      for (let row = range.top; row <= range.bottom; row += 1) {
        for (let column = range.left; column <= range.right; column += 1) {
          results.push(
            toJsonObject({ sheetName: sheet.name, ...getCellSnapshot(sheet.getCell(row, column)) })
          )
        }
      }
    }
    return toJsonObject({ sourcePath, cells: results })
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
    const forcedChanges: CellChange[] = []
    for (const operation of args.actions) {
      if (operation.type === 'add_sheet') {
        if (workbook.getWorksheet(String(operation.sheetName)))
          throw new Error(`工作表已存在: ${String(operation.sheetName)}`)
        workbook.addWorksheet(String(operation.sheetName))
        forcedChanges.push({
          sheetName: String(operation.sheetName),
          address: 'A1',
          kind: 'added'
        })
      } else if (operation.type === 'delete_sheet') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        if (workbook.worksheets.length === 1) throw new Error('Excel 最终必须至少保留一个工作表')
        workbook.removeWorksheet(sheet.id)
        forcedChanges.push({ sheetName: sheet.name, address: 'A1', kind: 'deleted' })
      } else if (operation.type === 'rename_sheet') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        if (workbook.getWorksheet(String(operation.newName)))
          throw new Error(`工作表已存在: ${String(operation.newName)}`)
        const previousName = sheet.name
        sheet.name = String(operation.newName)
        forcedChanges.push(
          { sheetName: previousName, address: 'A1', kind: 'deleted' },
          { sheetName: sheet.name, address: 'A1', kind: 'added' }
        )
      } else if (operation.type === 'merge_cells') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        sheet.mergeCells(String(operation.range))
        forcedChanges.push({
          sheetName: sheet.name,
          address: sheet.getCell(String(operation.range).split(':')[0]).address,
          kind: 'modified'
        })
      } else if (operation.type === 'set_range') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        const start = parseRange(String(operation.startCell))
        for (let rowIndex = 0; rowIndex < operation.values.length; rowIndex += 1) {
          const values = operation.values[rowIndex]
          for (let columnIndex = 0; columnIndex < values.length; columnIndex += 1) {
            const cell = sheet.getCell(start.top + rowIndex, start.left + columnIndex)
            const value = values[columnIndex]
            cell.value =
              value && typeof value === 'object' && 'formula' in value
                ? { formula: String(value.formula) }
                : (value as ExcelJS.CellValue)
            applyStyle(cell, operation.style as Record<string, unknown> | undefined)
          }
        }
      } else if (operation.type === 'clear_range') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        const range = parseRange(String(operation.range))
        for (let row = range.top; row <= range.bottom; row += 1) {
          for (let column = range.left; column <= range.right; column += 1)
            sheet.getCell(row, column).value = null
        }
      } else if (operation.type === 'insert_rows' || operation.type === 'delete_rows') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        const count = Number(operation.count)
        sheet.spliceRows(
          Number(operation.startRow),
          operation.type === 'delete_rows' ? count : 0,
          ...Array.from({ length: operation.type === 'insert_rows' ? count : 0 }, () => [])
        )
      } else if (operation.type === 'set_column_width') {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        sheet.getColumn(operation.column as string | number).width = Number(operation.width)
        const column =
          typeof operation.column === 'number'
            ? columnLetters(operation.column)
            : String(operation.column).toUpperCase()
        forcedChanges.push({ sheetName: sheet.name, address: `${column}1`, kind: 'modified' })
      } else {
        const sheet = workbook.getWorksheet(String(operation.sheetName))
        if (!sheet) throw new Error(`工作表不存在: ${String(operation.sheetName)}`)
        const cell = sheet.getCell(String(operation.address))
        if (operation.type === 'delete_cell') cell.value = null
        else {
          if (operation.formula !== undefined) cell.value = { formula: String(operation.formula) }
          else cell.value = operation.value as ExcelJS.CellValue
          applyStyle(cell, operation.style as Record<string, unknown> | undefined)
        }
      }
    }
    if (workbook.worksheets.length === 0) throw new Error('Excel 最终必须至少保留一个工作表')
    workbook.calcProperties.fullCalcOnLoad = true
    const afterBytes = Buffer.from(await workbook.xlsx.writeBuffer())
    const beforeWorkbook = beforeBytes ? await loadWorkbook(beforeBytes) : null
    const afterWorkbook = await loadWorkbook(afterBytes)
    const operationChanges = mergeChanges(
      compareWorkbooks(beforeWorkbook, afterWorkbook),
      forcedChanges
    )
    if (operationChanges.length === 0)
      return toJsonObject({ sourcePath, changed: false, changes: [], postWriteReadback: [] })
    const baseline = state.baselineBytesByPath.get(sourcePath)
    const baselineWorkbook = baseline ? await loadWorkbook(baseline) : null
    const cumulativeChanges = mergeChanges(
      compareWorkbooks(baselineWorkbook, afterWorkbook),
      forcedChanges
    )
    const diffBytes = await buildDiffWorkbook({
      before: baselineWorkbook,
      after: afterWorkbook,
      changes: cumulativeChanges
    })
    const changeId = state.recordsByPath.get(sourcePath)?.id || randomUUID()
    const artifactRoot = path.join(
      input.workspaceRootPath,
      '.ncurator',
      'file-changes',
      input.runId
    )
    const snapshotRoot = path.join(
      input.workspaceRootPath,
      '.ncurator',
      'file-change-snapshots',
      input.runId
    )
    await fs.mkdir(artifactRoot, { recursive: true })
    await fs.mkdir(snapshotRoot, { recursive: true })
    const beforeSnapshotPath = baseline
      ? path.join(snapshotRoot, `${changeId}-${path.basename(sourcePath)}`)
      : undefined
    if (baseline && beforeSnapshotPath) await fs.writeFile(beforeSnapshotPath, baseline)
    const previewPath = path.join(artifactRoot, `${changeId}-${randomUUID()}.diff.xlsx`)
    await fs.writeFile(previewPath, diffBytes)
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
    emitFileArtifactEvent({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId,
      capability: 'excel',
      artifactPath: sourcePath,
      operation: record.operation,
      applyId: record.id
    })
    const postWriteReadback = operationChanges.map((change) => {
      const cell = afterWorkbook.getWorksheet(change.sheetName)?.getCell(change.address)
      return cell
        ? { sheetName: change.sheetName, ...getCellSnapshot(cell) }
        : {
            sheetName: change.sheetName,
            address: change.address,
            value: null,
            displayValue: '',
            type: 'blank'
          }
    })
    return toJsonObject({
      sourcePath,
      changed: true,
      changes: operationChanges,
      postWriteReadback,
      diffPath: previewPath,
      record
    })
  }

  return { outline, search, readCells, edit }
}

export const toExcelToolFailure = (sourcePath: string, error: unknown): JsonObject => ({
  ok: false,
  sourcePath,
  error: error instanceof Error ? error.message : String(error)
})

import type ExcelJS from 'exceljs'
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  LocaleType,
  VerticalAlign,
  WrapStrategy,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData
} from '@univerjs/core'
export const excelColor = (input?: Partial<ExcelJS.Color>): { rgb: string } | undefined => {
  const argb = input?.argb
  if (!argb) return undefined
  return { rgb: `#${argb.slice(-6)}` }
}

export const excelSheetId = (sheet: ExcelJS.Worksheet): string => `sheet-${String(sheet.id)}`

/** ExcelJS's value getter omits falsy formula results; its result getter preserves them. */
export const excelCellValue = (cell: ExcelJS.Cell): ExcelJS.CellValue => {
  const value = cell.value
  return value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)
    ? { ...value, result: cell.result }
    : value
}

const borderStyle = (
  side?: Partial<ExcelJS.Border>
): { s: BorderStyleTypes; cl: { rgb: string } } | undefined => {
  if (!side?.style) return undefined
  const styles: Partial<Record<ExcelJS.BorderStyle, BorderStyleTypes>> = {
    thin: BorderStyleTypes.THIN,
    medium: BorderStyleTypes.MEDIUM,
    thick: BorderStyleTypes.THICK,
    double: BorderStyleTypes.DOUBLE,
    dotted: BorderStyleTypes.DOTTED,
    dashed: BorderStyleTypes.DASHED,
    dashDot: BorderStyleTypes.DASH_DOT,
    dashDotDot: BorderStyleTypes.DASH_DOT_DOT,
    hair: BorderStyleTypes.HAIR
  }
  return {
    s: styles[side.style] || BorderStyleTypes.THIN,
    cl: excelColor(side.color) || { rgb: '#D9D9D9' }
  }
}

const cellStyle = (cell: ExcelJS.Cell): IStyleData => ({
  ff: cell.font?.name || undefined,
  fs: cell.font?.size,
  bl: cell.font?.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE,
  it: cell.font?.italic ? BooleanNumber.TRUE : BooleanNumber.FALSE,
  cl: excelColor(cell.font?.color),
  bg:
    cell.fill?.type === 'pattern' && cell.fill.fgColor ? excelColor(cell.fill.fgColor) : undefined,
  n: cell.numFmt && cell.numFmt !== 'General' ? { pattern: cell.numFmt } : undefined,
  ht:
    cell.alignment?.horizontal === 'center'
      ? HorizontalAlign.CENTER
      : cell.alignment?.horizontal === 'right'
        ? HorizontalAlign.RIGHT
        : cell.alignment?.horizontal === 'left'
          ? HorizontalAlign.LEFT
          : undefined,
  vt:
    cell.alignment?.vertical === 'middle'
      ? VerticalAlign.MIDDLE
      : cell.alignment?.vertical === 'bottom'
        ? VerticalAlign.BOTTOM
        : cell.alignment?.vertical === 'top'
          ? VerticalAlign.TOP
          : undefined,
  tb: cell.alignment?.wrapText ? WrapStrategy.WRAP : undefined,
  bd: {
    t: borderStyle(cell.border?.top),
    r: borderStyle(cell.border?.right),
    b: borderStyle(cell.border?.bottom),
    l: borderStyle(cell.border?.left)
  }
})

const cellData = (cell: ExcelJS.Cell): ICellData => {
  const mergedSlave = cell.isMerged && cell.master.address !== cell.address
  const formula = mergedSlave ? undefined : cell.formula || undefined
  const valueWithResult = excelCellValue(cell)
  const rawValue = mergedSlave
    ? null
    : formula &&
        valueWithResult &&
        typeof valueWithResult === 'object' &&
        'result' in valueWithResult
      ? valueWithResult.result
      : valueWithResult
  const value =
    rawValue instanceof Date
      ? rawValue.getTime() / 86_400_000 + 25_569
      : typeof rawValue === 'string' ||
          typeof rawValue === 'number' ||
          typeof rawValue === 'boolean'
        ? rawValue
        : rawValue == null
          ? undefined
          : cell.text
  return {
    v: value,
    f: formula ? `=${formula}` : undefined,
    t:
      typeof value === 'number'
        ? CellValueType.NUMBER
        : typeof value === 'boolean'
          ? CellValueType.BOOLEAN
          : CellValueType.STRING,
    s: cellStyle(cell)
  }
}

export const toExcelWorkbookData = (workbook: ExcelJS.Workbook, name: string): IWorkbookData => {
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  workbook.eachSheet((sheet) => {
    const id = excelSheetId(sheet)
    sheetOrder.push(id)
    const cells: Record<number, Record<number, ICellData>> = {}
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        ;(cells[rowNumber - 1] ||= {})[columnNumber - 1] = cellData(cell)
      })
    })
    const rowData: Record<number, { h: number }> = {}
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.height) rowData[rowNumber - 1] = { h: Math.round(row.height * 1.333) }
    })
    const columns = sheet.columns || []
    const layoutColumnCount = Math.max(sheet.columnCount, columns.length, 1)
    const columnData: Record<number, { w: number }> = {}
    for (let index = 1; index <= layoutColumnCount; index += 1) {
      const width = sheet.getColumn(index).width
      if (width) columnData[index - 1] = { w: Math.round(width * 7) }
    }
    const mergeData = (sheet.model.merges || []).map((range) => {
      const parsed = sheet.getCell(range.split(':')[0])
      const end = sheet.getCell(range.split(':')[1] || range.split(':')[0])
      return {
        startRow: Number(parsed.row) - 1,
        startColumn: Number(parsed.col) - 1,
        endRow: Number(end.row) - 1,
        endColumn: Number(end.col) - 1
      }
    })
    const frozen = (sheet.views || []).find((view) => view.state === 'frozen')
    const xSplit = frozen?.state === 'frozen' ? frozen.xSplit || 0 : 0
    const ySplit = frozen?.state === 'frozen' ? frozen.ySplit || 0 : 0
    sheets[id] = {
      id,
      freeze:
        xSplit || ySplit ? { xSplit, ySplit, startRow: ySplit, startColumn: xSplit } : undefined,
      name: sheet.name,
      tabColor: excelColor(sheet.properties.tabColor)?.rgb || '',
      hidden: sheet.state === 'visible' ? BooleanNumber.FALSE : BooleanNumber.TRUE,
      rowCount: Math.max(100, sheet.rowCount + 20),
      columnCount: Math.max(26, layoutColumnCount + 10),
      cellData: cells,
      rowData,
      columnData,
      mergeData,
      showGridlines: BooleanNumber.TRUE,
      rightToLeft: BooleanNumber.FALSE
    }
  })
  if (sheetOrder.length === 0) throw new Error('工作簿没有可预览的工作表')
  return {
    id: `xlsx-${Date.now().toString(36)}`,
    name,
    appVersion: '1.0.0',
    locale: LocaleType.ZH_CN,
    styles: {},
    sheetOrder,
    sheets
  }
}

export const hasExcelFormulas = (data: IWorkbookData): boolean =>
  Object.values(data.sheets).some((sheet) =>
    Object.values(sheet.cellData || {}).some((row) =>
      Object.values<ICellData>(row).some((cell) => Boolean(cell?.f))
    )
  )

import type { FUniver } from '@univerjs/core/facade'
import type { IWorkbookData, ICellData } from '@univerjs/core'
import type { ReviewLocation } from '../../../../shared/fileReview'
import { officeViews } from './officeViewState'

/** Exclude selection, scrolling, zoom and calculated caches from the save trigger. */
export function excelEditFingerprint(data: IWorkbookData): string {
  return JSON.stringify(
    data.sheetOrder.map((id) => {
      const sheet = data.sheets[id]
      return {
        id,
        name: sheet.name,
        hidden: sheet.hidden,
        tabColor: sheet.tabColor,
        merges: sheet.mergeData,
        rows: Object.entries(sheet.rowData || {}).map(([index, row]) => [
          index,
          { h: row.h, hd: row.hd }
        ]),
        columns: Object.entries(sheet.columnData || {}).map(([index, column]) => [
          index,
          { w: column.w, hd: column.hd }
        ]),
        freeze: sheet.freeze,
        cells: Object.entries(sheet.cellData || {}).map(([row, cells]) => [
          row,
          Object.entries<ICellData>(cells).map(([column, cell]) => [
            column,
            {
              v: cell.f ? undefined : cell.v,
              f: cell.f,
              p: cell.p?.body,
              s: typeof cell.s === 'string' ? data.styles?.[cell.s] : cell.s
            }
          ])
        ])
      }
    })
  )
}
export function captureExcelView(api: FUniver, key: string) {
  const sheet = api.getActiveWorkbook()?.getActiveSheet()
  if (!sheet) return
  const scroll = sheet.getScrollState()
  officeViews.set(key, {
    kind: 'excel',
    sheetId: sheet.getSheetId(),
    sheetName: sheet.getSheetName(),
    row: scroll.sheetViewStartRow || 0,
    column: scroll.sheetViewStartColumn || 0,
    offsetX: scroll.offsetX || 0,
    offsetY: scroll.offsetY || 0,
    zoom: sheet.getZoom(),
    selection: sheet.getActiveRange()?.getA1Notation()
  })
}
export async function restoreExcelView(api: FUniver, key: string) {
  const view = officeViews.get(key),
    book = api.getActiveWorkbook()
  if (view?.kind !== 'excel' || !book) return
  const sheet = book.getSheetBySheetId(view.sheetId) || book.getSheetByName(view.sheetName)
  if (!sheet) return
  book.setActiveSheet(sheet)
  sheet.zoom(view.zoom)
  if (view.selection) sheet.setActiveRange(sheet.getRange(view.selection))
  await api.executeCommand('sheet.command.scroll-view', {
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    sheetViewStartRow: view.row,
    sheetViewStartColumn: view.column
  })
}
export function revealExcelLocation(
  api: FUniver,
  target: Extract<ReviewLocation, { kind: 'excel' }>
): boolean {
  const book = api.getActiveWorkbook(),
    sheet = book?.getSheetByName(target.sheet)
  if (!book || !sheet) return false
  const original = sheet.getRange(target.address)
  const originalRange = original.getRange()
  const normalize = (value: string) => value.replace(/^=/, '').replace(/\s+/g, ' ').trim()
  const matchesCell = (row: number, column: number, value: string) => {
    if (row < 0 || column < 0) return false
    const cell = sheet.getRange(row, column)
    return [cell.getDisplayValue(), String(cell.getValue() ?? ''), cell.getFormula()].some(
      (candidate) => normalize(candidate) === normalize(value)
    )
  }
  const axes = target.anchors || []
  const contextRequired =
    axes.some((a) => a.row === 0 && a.column !== 0) &&
    axes.some((a) => a.column === 0 && a.row !== 0)
  const snapshot = book.save().sheets[sheet.getSheetId()]
  const candidates: Array<{ row: number; column: number; changed: boolean }> = []
  for (const [r, cells] of Object.entries(snapshot.cellData || {}))
    for (const c of Object.keys(cells)) {
      const row = Number(r),
        column = Number(c)
      const matching = axes.filter((anchor) =>
        matchesCell(row + anchor.row, column + anchor.column, anchor.value)
      )
      const anchored =
        matching.some((a) => a.row === 0 && a.column !== 0) &&
        matching.some((a) => a.column === 0 && a.row !== 0)
      const valueMatches = matchesCell(row, column, target.value)
      if (
        (contextRequired ? anchored : matching.length === axes.length) &&
        (valueMatches || anchored)
      )
        candidates.push({ row, column, changed: !valueMatches })
      if (candidates.length > 1) return false
    }
  if (candidates.length !== 1) return false
  const { row, column } = candidates[0]
  book.setActiveSheet(sheet)
  const range = sheet.getRange(
    row,
    column,
    originalRange.endRow - originalRange.startRow + 1,
    originalRange.endColumn - originalRange.startColumn + 1
  )
  sheet.scrollToCell(row, column, 0)
  sheet.setActiveRange(range)
  const mark = range.highlight({ stroke: '#0B6BCB', fill: 'rgba(11,107,203,0.15)' })
  setTimeout(() => mark.dispose(), 1500)
  return true
}

import type { FUniver } from '@univerjs/core/facade'
import { RANGE_TYPE, type IRange } from '@univerjs/core'
import type { DocumentSelectionNode } from '../../../../../shared/types'
import { MAX_EXCEL_SELECTION_CELLS } from '../../../../../shared/documentSelection'
import { newSelection, type SelectionAdapter } from './types'

type ExcelAnchor = Extract<NonNullable<DocumentSelectionNode['anchor']>, { kind: 'excel' }>
const intersects = (a: IRange, b: IRange) =>
  a.startRow <= b.endRow &&
  b.startRow <= a.endRow &&
  a.startColumn <= b.endColumn &&
  b.startColumn <= a.endColumn
const address = (row: number, column: number) => {
  let letters = ''
  for (let n = column + 1; n; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  return `${letters}${row + 1}`
}
export function excelAdapter(
  api: FUniver,
  filePath: string,
  container: HTMLElement
): SelectionAdapter {
  const workbook = () => api.getActiveWorkbook()
  const sheetFor = (a: ExcelAnchor) => workbook()?.getSheetBySheetId(a.sheetId)
  const snapshot = (a: ExcelAnchor): string | null => {
    const sheet = sheetFor(a)
    if (!sheet || sheet.getSheetName() !== a.sheetName) return null
    const range = sheet.getRange(
      a.startRow,
      a.startColumn,
      a.endRow - a.startRow + 1,
      a.endColumn - a.startColumn + 1
    )
    const cells = range.getCellDataGrid()
    return JSON.stringify({
      display: range.getDisplayValues(),
      cells: cells.map((row) =>
        row.map((cell) => ({ value: cell?.v ?? null, formula: cell?.f || null }))
      ),
      merges: sheet
        .getMergeData()
        .map((merge) => merge.getRange())
        .filter((merge) => intersects(merge, a))
    })
  }
  const matching = (node: DocumentSelectionNode) =>
    node.anchor?.kind === 'excel' && snapshot(node.anchor) === node.selectedText
      ? node.anchor
      : null
  return {
    capture: (event) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('canvas') &&
        event instanceof PointerEvent
      )
        return null
      const sheet = workbook()?.getActiveSheet()
      const ranges = sheet?.getSelection()?.getActiveRangeList() || []
      if (!sheet || !ranges.length) return null
      if (ranges.length !== 1) throw new Error('请每次引用一个连续单元格区域。')
      const range = { ...ranges[0].getRange() }
      if (range.rangeType !== undefined && range.rangeType !== RANGE_TYPE.NORMAL)
        throw new Error('请选择有限的单元格区域，不支持整行或整列引用。')
      let changed = true
      while (changed) {
        changed = false
        for (const item of sheet.getMergeData()) {
          const merge = item.getRange()
          if (!intersects(range, merge)) continue
          const next = {
            startRow: Math.min(range.startRow, merge.startRow),
            endRow: Math.max(range.endRow, merge.endRow),
            startColumn: Math.min(range.startColumn, merge.startColumn),
            endColumn: Math.max(range.endColumn, merge.endColumn)
          }
          if (
            next.startRow !== range.startRow ||
            next.endRow !== range.endRow ||
            next.startColumn !== range.startColumn ||
            next.endColumn !== range.endColumn
          ) {
            Object.assign(range, next)
            changed = true
          }
        }
      }
      if (
        (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) >
        MAX_EXCEL_SELECTION_CELLS
      )
        throw new Error('引用最多包含 10,000 个单元格，请缩小范围。')
      const first = address(range.startRow, range.startColumn),
        last = address(range.endRow, range.endColumn)
      const anchor: ExcelAnchor = {
        kind: 'excel',
        sheetId: sheet.getSheetId(),
        sheetName: sheet.getSheetName(),
        range: first === last ? first : `${first}:${last}`,
        startRow: range.startRow,
        endRow: range.endRow,
        startColumn: range.startColumn,
        endColumn: range.endColumn
      }
      const node = newSelection(filePath, snapshot(anchor) || '')
      node.anchor = anchor
      return { node }
    },
    locate: (node) => {
      const a = matching(node)
      if (!a || workbook()?.getActiveSheet().getSheetId() !== a.sheetId) return null
      const sheet = sheetFor(a)!
      return {
        rects: () => {
          const canvas = container.querySelector('canvas')?.getBoundingClientRect()
          if (!canvas) return []
          const zoom = sheet.getZoom()
          const scroll = sheet.getScrollState()
          const origin = sheet.getRange(0, 0).getCellRect()
          const scrolled = sheet
            .getRange(scroll.sheetViewStartRow, scroll.sheetViewStartColumn)
            .getCellRect()
          const freeze = sheet.getFreeze()
          const axes = (start: number, end: number, split: number, count: number) => {
            if (split <= 0 || count <= 0) return [{ start, end, frozen: false }]
            return [
              {
                start: Math.max(start, split - count),
                end: Math.min(end, split - 1),
                frozen: true
              },
              { start: Math.max(start, split), end, frozen: false }
            ].filter((part) => part.start <= part.end)
          }
          const rects: DOMRect[] = []
          const frozenOrigin = sheet
            .getRange(
              Math.max(0, freeze.startRow - freeze.ySplit),
              Math.max(0, freeze.startColumn - freeze.xSplit)
            )
            .getCellRect()
          const boundary = sheet
            .getRange(Math.max(0, freeze.startRow), Math.max(0, freeze.startColumn))
            .getCellRect()
          for (const rows of axes(a.startRow, a.endRow, freeze.startRow, freeze.ySplit)) {
            for (const columns of axes(
              a.startColumn,
              a.endColumn,
              freeze.startColumn,
              freeze.xSplit
            )) {
              const first = sheet.getRange(rows.start, columns.start).getCellRect()
              const last = sheet.getRange(rows.end, columns.end).getCellRect()
              const dx = columns.frozen
                ? frozenOrigin.left - origin.left
                : scrolled.left - origin.left + scroll.offsetX
              const dy = rows.frozen
                ? frozenOrigin.top - origin.top
                : scrolled.top - origin.top + scroll.offsetY
              const frozenWidth = freeze.xSplit > 0 ? boundary.left - frozenOrigin.left : 0
              const frozenHeight = freeze.ySplit > 0 ? boundary.top - frozenOrigin.top : 0
              const left = Math.max(
                canvas.left + (first.left - dx) * zoom,
                canvas.left + (origin.left + (columns.frozen ? 0 : frozenWidth)) * zoom
              )
              const top = Math.max(
                canvas.top + (first.top - dy) * zoom,
                canvas.top + (origin.top + (rows.frozen ? 0 : frozenHeight)) * zoom
              )
              const right = Math.min(
                canvas.left + (last.right - dx) * zoom,
                columns.frozen ? canvas.left + (origin.left + frozenWidth) * zoom : canvas.right
              )
              const bottom = Math.min(
                canvas.top + (last.bottom - dy) * zoom,
                rows.frozen ? canvas.top + (origin.top + frozenHeight) * zoom : canvas.bottom
              )
              if (right > left && bottom > top)
                rects.push(new DOMRect(left, top, right - left, bottom - top))
            }
          }
          return rects
        },
        reveal: () => {
          sheet.scrollToCell(a.startRow, a.startColumn)
          sheet.setActiveRange(sheet.getRange(a.range))
        }
      }
    },
    navigate: (node) => {
      const a = matching(node)
      if (!a) return false
      const sheet = sheetFor(a)!
      workbook()?.setActiveSheet(sheet)
      sheet.scrollToCell(a.startRow, a.startColumn)
      return false
    },
    overlaps: (node, candidate) => {
      const a = matching(node),
        b = candidate.node.anchor
      return !!a && b?.kind === 'excel' && a.sheetId === b.sheetId && intersects(a, b)
    },
    subscribe: (refresh) => {
      const listener = api.addEvent(api.Event.Scroll, refresh)
      const selection = api.addEvent(api.Event.SelectionChanged, refresh)
      const zoom = api.onCommandExecuted(refresh)
      return () => {
        listener.dispose()
        selection.dispose()
        zoom.dispose()
      }
    },
    paint: (nodes, active, hoverId) => {
      const unique = new Map([...nodes, ...(active ? [active] : [])].map((node) => [node.id, node]))
      const marks = [...unique.values()].flatMap((node) => {
        const a = matching(node)
        if (!a || workbook()?.getActiveSheet().getSheetId() !== a.sheetId) return []
        return [
          sheetFor(a)!
            .getRange(a.range)
            .highlight({
              stroke: '#B990DF',
              fill:
                node.id === hoverId || node.id === active?.id
                  ? 'rgba(219,197,246,0.45)'
                  : 'rgba(233,221,251,0.35)'
            })
        ]
      })
      return () => marks.forEach((mark) => mark.dispose())
    }
  }
}

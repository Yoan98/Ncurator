import type { DocumentSelectionNode } from '../../../../../shared/types'
import type { SelectionLocation } from '../../workbench/composer/DocumentSelectionContext'

type TextRun = { node: Text; start: number; end: number }
export type PreviewText = { text: string; runs: TextRun[] }
const blocks = new Set([
  'P',
  'TABLE',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'SECTION',
  'DIV',
  'OL',
  'UL',
  'LI'
])

const isHidden = (element: Element): boolean => {
  const style = getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

function tableGrid(table: HTMLTableElement): (HTMLTableCellElement | null)[][] {
  const rows = [...table.rows]
  const grid: (HTMLTableCellElement | null)[][] = rows.map(() => [])
  for (const [rowIndex, row] of rows.entries()) {
    if (isHidden(row)) continue
    let column = 0
    for (const cell of row.cells) {
      // DOCX vertical merges render a hidden continuation cell beside the spanning cell.
      if (isHidden(cell)) continue
      while (grid[rowIndex][column] !== undefined) column += 1
      grid[rowIndex][column] = cell
      const endRow = Math.min(rows.length, rowIndex + (cell.rowSpan || rows.length - rowIndex))
      for (let r = rowIndex; r < endRow; r += 1) {
        for (let c = column; c < column + cell.colSpan; c += 1) {
          if (r !== rowIndex || c !== column) grid[r][c] = null
        }
      }
      column += cell.colSpan
    }
  }
  const columns = Math.max(0, ...grid.map((row) => row.length))
  return grid.map((row) => Array.from({ length: columns }, (_, column) => row[column] || null))
}

export function readPreviewText(container: HTMLElement | SVGElement): PreviewText {
  const runs: TextRun[] = []
  let text = ''
  const visit = (node: Node): void => {
    if (node instanceof Text) {
      if (node.data && node.parentElement instanceof Element) {
        runs.push({ node, start: text.length, end: text.length + node.data.length })
        text += node.data
      }
      return
    }
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) return
    if (
      node.matches(
        'style, script, template, title, desc, .react-pdf__Page__annotations, canvas, [data-selection-ignore]'
      ) ||
      isHidden(node)
    )
      return
    if (node instanceof HTMLBRElement) {
      text += '\n'
      return
    }
    if (node instanceof HTMLTableElement) {
      for (const [rowIndex, row] of tableGrid(node).entries()) {
        if (rowIndex) text += '\n\n'
        for (const [column, cell] of row.entries()) {
          if (column) text += '\t'
          if (cell) visit(cell)
        }
      }
      return
    }
    let hasContent = false
    for (const child of node.childNodes) {
      if (child instanceof Element && isHidden(child)) continue
      const block =
        (child instanceof HTMLElement && blocks.has(child.tagName)) ||
        (child instanceof SVGElement && child.tagName === 'text')
      if (block && hasContent) text += '\n'
      const start = text.length
      visit(child)
      if (block || text.length > start) hasContent = true
    }
  }
  visit(container.querySelector('.docx-wrapper') || container)
  return { text, runs }
}

export function captureSelection(
  container: HTMLElement | SVGElement,
  preview: PreviewText,
  range: Range
): SelectionLocation | null {
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer))
    return null
  const intersected = preview.runs.flatMap((run) => {
    if (!range.intersectsNode(run.node)) return []
    const start = range.startContainer === run.node ? range.startOffset : 0
    const end = range.endContainer === run.node ? range.endOffset : run.node.length
    return end > start ? [{ start: run.start + start, end: run.start + end }] : []
  })
  const first = intersected[0]
  const last = intersected.at(-1)
  if (!first || !last) return null
  const { start } = first
  const { end } = last
  if (!preview.text.slice(start, end).trim()) return null
  return { start, end, previewText: preview.text }
}

export function locateSelection(
  preview: PreviewText,
  node: DocumentSelectionNode,
  saved?: SelectionLocation
): SelectionLocation | null {
  if (
    saved?.previewText === preview.text &&
    preview.text.slice(saved.start, saved.end) === node.selectedText
  )
    return saved
  const positions: number[] = []
  let offset = 0
  while (offset <= preview.text.length) {
    const found = preview.text.indexOf(node.selectedText, offset)
    if (found < 0) break
    const before = preview.text.slice(0, found)
    const after = preview.text.slice(found + node.selectedText.length)
    if (before.endsWith(node.contextBefore) && after.startsWith(node.contextAfter))
      positions.push(found)
    offset = found + 1
  }
  if (positions.length !== 1) return null
  return {
    start: positions[0],
    end: positions[0] + node.selectedText.length,
    previewText: preview.text
  }
}

export function rangeForLocation(preview: PreviewText, location: SelectionLocation): Range | null {
  const first = preview.runs.find((run) => run.end > location.start)
  const last = preview.runs.findLast((run) => run.start < location.end && run.end > location.start)
  if (!first || !last) return null
  const range = document.createRange()
  range.setStart(first.node, Math.max(0, location.start - first.start))
  range.setEnd(last.node, Math.min(last.node.length, location.end - last.start))
  return range
}

// Text-only ranges exclude the empty part of paragraph boxes from the clickable area.
export function textRangesForLocation(preview: PreviewText, location: SelectionLocation): Range[] {
  return preview.runs
    .filter((run) => run.end > location.start && run.start < location.end)
    .map((run) => {
      const range = document.createRange()
      range.setStart(run.node, Math.max(0, location.start - run.start))
      range.setEnd(run.node, Math.min(run.node.length, location.end - run.start))
      return range
    })
}

/** Chromium does not consistently expose Range rectangles for SVG text. */
export function svgTextRects(preview: PreviewText, location: SelectionLocation): DOMRect[] {
  return preview.runs.flatMap((run) => {
    const element = run.node.parentElement
    if (!(element instanceof SVGTextContentElement)) return []
    const matrix = element.getScreenCTM()
    if (!matrix) return []
    const rects: DOMRect[] = []
    const start = Math.max(0, location.start - run.start)
    const end = Math.min(run.node.length, location.end - run.start, element.getNumberOfChars())
    for (let index = start; index < end; index++) {
      const box = element.getExtentOfChar(index)
      const corners = [
        new DOMPoint(box.x, box.y),
        new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height),
        new DOMPoint(box.x + box.width, box.y + box.height)
      ].map((point) => point.matrixTransform(matrix))
      const left = Math.min(...corners.map((point) => point.x)),
        top = Math.min(...corners.map((point) => point.y))
      rects.push(
        new DOMRect(
          left,
          top,
          Math.max(...corners.map((point) => point.x)) - left,
          Math.max(...corners.map((point) => point.y)) - top
        )
      )
    }
    return rects
  })
}

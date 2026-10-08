import type { DocumentSelectionNode } from '../../../../shared/types'
import type { SelectionLocation } from '../workbench/composer/DocumentSelectionContext'

type TextRun = { node: Text; start: number; end: number }
export type PreviewText = { text: string; runs: TextRun[] }
const unsupported =
  'header, footer, svg, math, .docx-header, .docx-footer, .docx-textbox, [data-docx-textbox]'

export function readPreviewText(container: HTMLElement): PreviewText {
  const runs: TextRun[] = []
  let text = ''
  const paragraphs = container.querySelectorAll('article p')
  paragraphs.forEach((paragraph) => {
    if (paragraph.closest(unsupported)) return
    if (runs.length) text += '\n'
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    )
    let node = walker.nextNode()
    while (node) {
      if (node instanceof HTMLBRElement && !node.closest(unsupported)) text += '\n'
      if (node instanceof Text && node.data && !node.parentElement?.closest(unsupported)) {
        runs.push({ node, start: text.length, end: text.length + node.data.length })
        text += node.data
      }
      node = walker.nextNode()
    }
  })
  return { text, runs }
}

export function captureSelection(
  container: HTMLElement,
  preview: PreviewText,
  range: Range
): SelectionLocation | null {
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  const endElement =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  if (
    !startElement ||
    !endElement ||
    !container.contains(startElement) ||
    !container.contains(endElement) ||
    !startElement.closest('article') ||
    !endElement.closest('article') ||
    startElement.closest(unsupported) ||
    endElement.closest(unsupported)
  )
    return null
  const startCell = startElement.closest('td, th')
  if (startCell !== endElement.closest('td, th')) return null
  if (range.cloneContents().querySelector('img, svg, table, header, footer')) return null
  const intersected = preview.runs.filter((run) => range.intersectsNode(run.node))
  const first = intersected[0]
  const last = intersected.at(-1)
  if (!first || !last) return null
  const start = first.start + (range.startContainer === first.node ? range.startOffset : 0)
  const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length)
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
  const last = preview.runs.find((run) => run.end >= location.end && run.start < location.end)
  if (!first || !last) return null
  const range = document.createRange()
  range.setStart(first.node, Math.max(0, location.start - first.start))
  range.setEnd(last.node, location.end - last.start)
  return range
}

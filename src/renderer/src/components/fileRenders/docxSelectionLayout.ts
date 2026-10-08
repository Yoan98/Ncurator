import type { PreviewText } from './docxSelectionText'

type Rect = { left: number; top: number; right: number; bottom: number }
export type SelectionFloatingPosition = {
  left: number
  top: number
  placement: 'above' | 'below'
}
export type SelectionMarkerPosition = { left: number; top: number; width: number }

const GAP = 8
export const SELECTION_MARKER_SIZE = 14
const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, Math.max(min, max)))

export function previewViewport(container: HTMLElement): Rect {
  const rect = container.getBoundingClientRect()
  return {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(window.innerWidth, rect.left + container.clientWidth),
    bottom: Math.min(window.innerHeight, rect.top + container.clientHeight)
  }
}

export function positionSelectionFloating(
  range: Range,
  viewport: Rect,
  floating: { width: number; height: number }
): SelectionFloatingPosition | null {
  const rects = [...range.getClientRects()].filter(
    (rect) => rect.width && rect.height && overlaps(rect, viewport)
  )
  const first = rects[0]
  const last = rects.at(-1)
  if (!first || !last) return null
  const below = last.bottom + GAP
  const above = first.top - GAP - floating.height
  const fitsBelow = below + floating.height <= viewport.bottom - GAP
  const fitsAbove = above >= viewport.top + GAP
  const placement = fitsBelow ? 'below' : 'above'
  // Long selections may span the viewport; keep the input beside the visible end.
  const top = fitsBelow ? below : fitsAbove ? above : last.top - GAP - floating.height
  return {
    left: clamp(last.left, viewport.left + GAP, viewport.right - GAP - floating.width),
    top: clamp(top, viewport.top + GAP, viewport.bottom - GAP - floating.height),
    placement
  }
}

export function visiblePreviewObstacles(preview: PreviewText, container: HTMLElement): Rect[] {
  const viewport = previewViewport(container)
  const range = document.createRange()
  const rects: Rect[] = []
  for (const run of preview.runs) {
    range.selectNodeContents(run.node)
    for (const rect of range.getClientRects()) {
      if (rect.width && rect.height && overlaps(rect, viewport)) rects.push(rect)
    }
  }
  for (const element of container.querySelectorAll('article img, article svg')) {
    const rect = element.getBoundingClientRect()
    if (overlaps(rect, viewport)) rects.push(rect)
  }
  return rects
}

export function positionSelectionMarker(
  range: Range,
  viewport: Rect,
  obstacles: Rect[],
  number: number
): SelectionMarkerPosition | null {
  const tail = range.cloneRange()
  if (range.endContainer instanceof Text && range.endOffset > 0) {
    const node = range.endContainer
    const minimum = range.startContainer === node ? range.startOffset : 0
    let end = range.endOffset
    while (end > minimum && /\s/.test(node.data[end - 1])) end -= 1
    if (end > minimum) {
      const characterLength = Array.from(node.data.slice(minimum, end)).at(-1)?.length || 1
      tail.setStart(node, end - characterLength)
      tail.setEnd(node, end)
    }
  }
  const rect = [...tail.getClientRects()].filter((item) => item.width && item.height).at(-1)
  if (!rect || !overlaps(rect, viewport)) return null
  const width = Math.max(SELECTION_MARKER_SIZE, String(number).length * 5 + 6)
  const top = rect.top - SELECTION_MARKER_SIZE - 1
  const free = (left: number, y: number): boolean => {
    const candidate = { left, top: y, right: left + width, bottom: y + SELECTION_MARKER_SIZE }
    return (
      candidate.left >= viewport.left + 4 &&
      candidate.right <= viewport.right - 4 &&
      candidate.top >= viewport.top + 4 &&
      candidate.bottom <= viewport.bottom - 4 &&
      !obstacles.some((item) => overlaps(candidate, item))
    )
  }
  // Stay beside the last selected glyph. Never move an annotation to the page gutter.
  const columns = [2, 6, 10, 14, 18, 22, 26, -width - 2].map((offset) => rect.right + offset)
  for (const offset of [0, -4, 4, -8, 8, -12, 12, -16]) {
    for (const left of columns) {
      if (free(left, top + offset)) return { left, top: top + offset, width }
    }
  }
  return null
}

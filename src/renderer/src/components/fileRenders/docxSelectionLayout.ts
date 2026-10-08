import type { PreviewText } from './docxSelectionText'

type Rect = { left: number; top: number; right: number; bottom: number }
export type SelectionFloatingPosition = {
  left: number
  top: number
  placement: 'above' | 'below'
}
export type SelectionMarkerPosition = { left: number; top: number; width: number }

const GAP = 8
const MARKER_HEIGHT = 24
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
  const rect = [...range.getClientRects()].filter((item) => item.width && item.height).at(-1)
  if (!rect || !overlaps(rect, viewport)) return null
  const width = Math.max(24, String(number).length * 6 + 14)
  const top = clamp(
    rect.top + (rect.height - MARKER_HEIGHT) / 2,
    viewport.top + 4,
    viewport.bottom - MARKER_HEIGHT - 4
  )
  const free = (left: number, y: number): boolean => {
    const candidate = { left, top: y, right: left + width, bottom: y + MARKER_HEIGHT }
    return (
      candidate.left >= viewport.left + 4 &&
      candidate.right <= viewport.right - 4 &&
      candidate.top >= viewport.top + 4 &&
      candidate.bottom <= viewport.bottom - 4 &&
      !obstacles.some((item) => overlaps(candidate, item))
    )
  }
  const tail = rect.right + 4
  if (free(tail, top)) return { left: tail, top, width }

  const endElement =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
  const article = endElement?.closest('article')?.getBoundingClientRect()
  const rightEdge = viewport.right - width - 4
  const gutter = article ? clamp(article.right + 4, viewport.left + 4, rightEdge) : rightEdge
  const columns = [...new Set([gutter, gutter + width, rightEdge, viewport.left + 4])]
  // Test the entire hit target, including neighbouring text and other markers.
  for (let distance = 0; distance < viewport.bottom - viewport.top; distance += MARKER_HEIGHT) {
    const rows = distance ? [top + distance, top - distance] : [top]
    for (const y of rows) {
      for (const left of columns) {
        if (free(left, y)) return { left, top: y, width }
      }
    }
  }
  return null
}

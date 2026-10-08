type Rect = { left: number; top: number; right: number; bottom: number }
export type SelectionFloatingPosition = {
  left: number
  top: number
  placement: 'above' | 'below'
}
const GAP = 8
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

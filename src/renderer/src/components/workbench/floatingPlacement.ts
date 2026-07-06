export type FloatingPlacementRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

export type FloatingPlacement = {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

export type FloatingPlacementAlign = 'start' | 'end'

export type ResolveFloatingPlacementInput = {
  triggerRect: FloatingPlacementRect
  viewportWidth: number
  viewportHeight: number
  preferredWidth: number
  preferredHeight: number
  maxHeight?: number
  minWidth?: number
  maxWidth?: number
  align?: FloatingPlacementAlign
  gap?: number
  viewportPadding?: number
}

const DEFAULT_GAP = 8
const DEFAULT_VIEWPORT_PADDING = 12

export const resolveFloatingPlacement = (
  input: ResolveFloatingPlacementInput
): FloatingPlacement => {
  const gap = input.gap ?? DEFAULT_GAP
  const viewportPadding = input.viewportPadding ?? DEFAULT_VIEWPORT_PADDING
  const minimumWidth = input.minWidth ?? 240
  const maxAvailableWidth = Math.max(0, input.viewportWidth - viewportPadding * 2)
  const constrainedPreferredWidth = Math.max(input.preferredWidth, minimumWidth)
  const cappedWidth = input.maxWidth
    ? Math.min(constrainedPreferredWidth, input.maxWidth)
    : constrainedPreferredWidth
  const width = Math.min(cappedWidth, maxAvailableWidth)
  const rawLeft =
    input.align === 'end' ? input.triggerRect.right - width : input.triggerRect.left
  const left = Math.min(
    Math.max(viewportPadding, rawLeft),
    Math.max(viewportPadding, input.viewportWidth - width - viewportPadding)
  )

  const spaceBelow = Math.max(
    0,
    input.viewportHeight - input.triggerRect.bottom - gap - viewportPadding
  )
  const spaceAbove = Math.max(0, input.triggerRect.top - gap - viewportPadding)
  const heightCap = input.maxHeight ?? input.preferredHeight
  const shouldOpenUp = spaceBelow < input.preferredHeight && spaceAbove > spaceBelow

  if (shouldOpenUp) {
    return {
      bottom: Math.max(viewportPadding, input.viewportHeight - input.triggerRect.top + gap),
      left,
      width,
      maxHeight: Math.min(spaceAbove, heightCap),
      placement: 'top'
    }
  }

  return {
    top: input.triggerRect.bottom + gap,
    left,
    width,
    maxHeight: Math.min(spaceBelow, heightCap),
    placement: 'bottom'
  }
}

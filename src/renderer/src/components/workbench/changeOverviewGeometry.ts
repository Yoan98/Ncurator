export interface OverviewViewport {
  top: number
  height: number
}

export function measureOverviewViewport(
  scrollTop: number,
  visibleHeight: number,
  contentHeight: number,
  trackHeight: number
): OverviewViewport | null {
  const maxScroll = contentHeight - visibleHeight
  if (maxScroll <= 1 || trackHeight <= 0) return null
  const height = Math.min(trackHeight, Math.max(20, (trackHeight * visibleHeight) / contentHeight))
  return { top: Math.max(0, Math.min(1, scrollTop / maxScroll)) * (trackHeight - height), height }
}

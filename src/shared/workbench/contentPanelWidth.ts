/** 右侧内容面板占「中间+右侧」主区宽度的比例（不含左侧栏） */

export const WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO = 0.48
export const WORKBENCH_CONTENT_PANEL_MAX_RATIO = 0.7
export const WORKBENCH_CONTENT_PANEL_MIN_WIDTH = 280
export const WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH = 500

export const clampWorkbenchContentPanelRatio = (ratio: number): number => {
  if (!Number.isFinite(ratio)) return WORKBENCH_CONTENT_PANEL_DEFAULT_RATIO
  return Math.min(WORKBENCH_CONTENT_PANEL_MAX_RATIO, Math.max(0.15, ratio))
}

export const resolveWorkbenchContentPanelWidth = (
  availableWidth: number,
  ratio: number
): number => {
  if (availableWidth <= 0) return 0
  const clampedRatio = clampWorkbenchContentPanelRatio(ratio)
  const maxByMiddle = Math.max(0, availableWidth - WORKBENCH_CONTENT_PANEL_MIDDLE_MIN_WIDTH)
  const maxByRatio = availableWidth * WORKBENCH_CONTENT_PANEL_MAX_RATIO
  const maxWidth = Math.max(0, Math.min(maxByMiddle, maxByRatio))
  if (maxWidth <= 0) return 0
  const minWidth = Math.min(WORKBENCH_CONTENT_PANEL_MIN_WIDTH, maxWidth)
  const preferred = availableWidth * clampedRatio
  return Math.round(Math.max(minWidth, Math.min(maxWidth, preferred)))
}

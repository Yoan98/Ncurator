/**
 * Visibility rule for the floating "back to latest" button.
 * Two thresholds (show / hide) so the button does not flicker while the user
 * rests right around one value.
 */

export const SCROLL_TO_LATEST_SHOW_PX = 320
export const SCROLL_TO_LATEST_HIDE_PX = 120

export const nextScrollToLatestVisible = (
  previousVisible: boolean,
  distanceToBottom: number
): boolean =>
  previousVisible
    ? distanceToBottom > SCROLL_TO_LATEST_HIDE_PX
    : distanceToBottom > SCROLL_TO_LATEST_SHOW_PX

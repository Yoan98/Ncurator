/**
 * Visibility rule for the floating "back to latest" button.
 * Two thresholds (show / hide) so the button does not flicker while the user
 * rests right around one value.
 *
 * 放在 shared 而不是 renderer：这是与框架无关的纯判定规则，
 * 便于按 unit 规则直接测试，不需要 jsdom 或 React。
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

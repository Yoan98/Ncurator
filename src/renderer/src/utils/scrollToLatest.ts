/**
 * 判定规则已移到 `src/shared/scrollToLatest.ts`（纯逻辑，便于 unit 覆盖）。
 * 这里保留原导出路径，组件不需要改 import。
 */
export {
  SCROLL_TO_LATEST_SHOW_PX,
  SCROLL_TO_LATEST_HIDE_PX,
  nextScrollToLatestVisible
} from '../../../shared/scrollToLatest'

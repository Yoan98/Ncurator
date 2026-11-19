/**
 * Renderer-only display preferences that never leave the window.
 *
 * 流式输出动效是产品的固定体验，不再提供开关，也不做任何自动降级：始终开启。
 */

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Scroll animations follow the same opt-outs as streaming text. */
export const shouldAnimateScroll = (): boolean => {
  if (prefersReducedMotion()) return false
  try {
    return !window.api.isE2EMode()
  } catch {
    return true
  }
}

/** 流式文字动效恒开，不再受设置项或环境开关影响。 */
export const useStreamingMarkdownAnimation = (): boolean => true

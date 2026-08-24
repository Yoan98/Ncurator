import { TOOL_RESULT_MAX_CHARS } from '../../shared/toolResultPersistence'

// 终端保留的滚动历史字符数（缓冲上限），只影响会话内能回读的最远内容，不直接进入模型上下文。
export const TERMINAL_RETAINED_SCROLLBACK_CHARS = 1_000_000

// 单次 terminal_run / terminal_read 返回的字符上限：占工具结果字符上限的比例。
export const TERMINAL_READ_MAX_RATIO = 1 / 2

export const TERMINAL_READ_MAX_CHARS = Math.max(
  1,
  Math.floor(TOOL_RESULT_MAX_CHARS * TERMINAL_READ_MAX_RATIO)
)

// 每个 chatSession 最多同时存在的运行中终端数，避免长命令会话无限制堆积。
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 5

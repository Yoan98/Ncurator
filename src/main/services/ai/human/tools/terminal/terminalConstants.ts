import { TOOL_RESULT_SPILL_MAX_CHARS } from '../../shared/toolResultPersistence'

// 终端保留的滚动历史字符数（缓冲上限），只影响会话内能回读的最远内容，不直接进入模型上下文。
export const TERMINAL_RETAINED_SCROLLBACK_CHARS = 1_000_000

// 单次 terminal_run / terminal_read 返回的字符上限：占工具结果字符上限的比例。
export const TERMINAL_READ_MAX_RATIO = 1 / 2

export const TERMINAL_READ_MAX_CHARS = Math.max(
  1,
  Math.floor(TOOL_RESULT_SPILL_MAX_CHARS * TERMINAL_READ_MAX_RATIO)
)

// 每个 run 最多同时运行的终端会话数，避免单轮长命令无限制堆积。
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 5

// 每个 chat 保留的终端会话总数上限。超出时按最久未使用回收旧会话，
// 避免跨轮遗留的卡死命令永久占满并发额度。
export const TERMINAL_MAX_SESSIONS_PER_CHAT = 8

// terminal_run 未指定 maxWaitSeconds 时，默认盯命令结束的秒数；到点后让出控制权，命令继续执行。
export const TERMINAL_DEFAULT_WATCH_SECONDS = 8

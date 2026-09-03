export type WorkbenchSessionMode = 'ai' | 'search'
export type WorkbenchSessionModeLock = 'none' | WorkbenchSessionMode

export const WORKBENCH_MODE_LOCK_HINTS = {
  disableSearch: '当前会话已有 AI 对话，不能切换到搜索',
  disableAi: '当前会话已在搜索模式，不能切回 AI 继续对话'
} as const

export const resolveWorkbenchSessionModeLock = (input: {
  hasAiHistory: boolean
  hasSearchHistory: boolean
  fallbackMode?: WorkbenchSessionMode
}): WorkbenchSessionModeLock => {
  if (input.hasAiHistory && input.hasSearchHistory) {
    return input.fallbackMode ?? 'ai'
  }
  if (input.hasAiHistory) return 'ai'
  if (input.hasSearchHistory) return 'search'
  return 'none'
}

export const isWorkbenchModeSwitchAllowed = (
  lock: WorkbenchSessionModeLock,
  nextMode: WorkbenchSessionMode
): boolean => lock === 'none' || lock === nextMode

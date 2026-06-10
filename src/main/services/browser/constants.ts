const DEFAULT_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT = 9333

const parseRemoteDebuggingPort = (): number => {
  const rawValue = String(process.env.NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT || '').trim()
  if (!rawValue) return DEFAULT_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT
  }
  return parsed
}

export const EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT = parseRemoteDebuggingPort()
export const EMBEDDED_BROWSER_PARTITION = 'persist:ncurator-browser'
export const EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS = 30_000
export const EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS = 60_000

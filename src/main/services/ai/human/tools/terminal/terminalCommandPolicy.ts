import { extractAbsolutePathTokens } from './commandParsing'
import { isPathInsideRoot } from './terminalPaths'

export const checkWorkspaceBoundary = (
  command: string,
  rootPath: string
): { ok: true } | { ok: false; reason: string } => {
  if (!rootPath) {
    return { ok: false, reason: 'workspace root path is missing' }
  }

  const text = String(command || '')
  if (/(^|\s)cd\s+\.\.(\/|\s|$)/.test(text) || text.includes('../')) {
    return { ok: false, reason: 'command contains path escape pattern (..)' }
  }

  const absolutePaths = extractAbsolutePathTokens(text)
  for (const candidatePath of absolutePaths) {
    if (!isPathInsideRoot(candidatePath, rootPath)) {
      return { ok: false, reason: `path out of workspace boundary: ${candidatePath}` }
    }
  }

  return { ok: true }
}

export const classifyCommandRisk = (command: string): 'low' | 'medium' | 'high' => {
  const text = String(command || '').toLowerCase()

  if (
    /\brm\s+-rf\b/.test(text) ||
    /\bmkfs\b/.test(text) ||
    /\bdd\b/.test(text) ||
    /\bshutdown\b/.test(text) ||
    /\breboot\b/.test(text) ||
    /\bchown\b/.test(text)
  ) {
    return 'high'
  }

  if (
    /\brm\b/.test(text) ||
    /\bmv\b/.test(text) ||
    /\bcp\b/.test(text) ||
    /\bmkdir\b/.test(text) ||
    /\btouch\b/.test(text) ||
    /\bchmod\b/.test(text) ||
    /\bcurl\b/.test(text) ||
    /\bwget\b/.test(text) ||
    /\bgit\s+push\b/.test(text) ||
    />/.test(text)
  ) {
    return 'medium'
  }

  return 'low'
}

export const classifyCommandMode = (command: string): 'read_only' | 'mutating' | 'unknown' => {
  const text = String(command || '').trim().toLowerCase()
  if (!text) return 'unknown'

  if (
    /\brm\b/.test(text) ||
    /\bmv\b/.test(text) ||
    /\bcp\b/.test(text) ||
    /\bmkdir\b/.test(text) ||
    /\btouch\b/.test(text) ||
    /\bchmod\b/.test(text) ||
    /\bgit\s+(add|commit|push|apply|am)\b/.test(text) ||
    /\btee\b/.test(text) ||
    />/.test(text)
  ) {
    return 'mutating'
  }

  if (
    /^\s*(cat|sed|head|tail|rg|grep|find|ls|pwd|stat|wc|git\s+status|git\s+diff|git\s+show|python\s+.*-c|python3\s+.*-c|node\s+.*-e)\b/.test(
      text
    )
  ) {
    return 'read_only'
  }

  return 'unknown'
}

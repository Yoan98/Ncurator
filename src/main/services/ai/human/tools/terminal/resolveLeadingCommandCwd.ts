import path from 'node:path'
import { stat } from 'node:fs/promises'

/**
 * Leading directory change before `;` / `&&` / end.
 * Covers POSIX `cd`, PowerShell `Set-Location`, optional `-Path` / `-LiteralPath`,
 * and cmd-style `cd /d` (models sometimes emit it even under PowerShell).
 */
const LEADING_CWD_PATTERN =
  /^\s*(?:cd(?:\s+\/d)?|Set-Location)(?:\s+-(?:Literal)?Path)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))\s*(?:&&|;|$)/iu

export type ResolveLeadingCommandCwdInput = {
  command: string
  currentPath: string
}

/**
 * Resolve the effective cwd for a command that starts with an explicit directory change.
 * Used both for session path updates and for file-change tracking baseline (before the PTY runs).
 */
export const resolveLeadingCommandCwd = async (
  input: ResolveLeadingCommandCwdInput
): Promise<string | undefined> => {
  const match = input.command.match(LEADING_CWD_PATTERN)
  if (!match) return undefined
  const requestedPath = match[1] || match[2] || match[3]
  if (!requestedPath) return undefined
  const nextPath = path.resolve(input.currentPath, requestedPath)
  try {
    return (await stat(nextPath)).isDirectory() ? nextPath : undefined
  } catch {
    return undefined
  }
}

/** Session start path + optional leading cd → cwd used for terminal change tracking. */
export const resolveTerminalTrackingCwd = async (input: {
  command: string
  sessionStartPath: string
}): Promise<string> => {
  const leading = await resolveLeadingCommandCwd({
    command: input.command,
    currentPath: input.sessionStartPath
  })
  return leading || path.resolve(input.sessionStartPath)
}

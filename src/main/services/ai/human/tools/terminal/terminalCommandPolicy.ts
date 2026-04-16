import { parseShellCommandSegments } from './commandParsing'
import { collectTerminalArtifactCandidates } from './terminalArtifacts'
import { isPathInsideRoot } from './terminalCwd'
import type { TerminalCommandAnalysis } from './types'
import { getAiRuntimePlatform } from '../../../utils/platform'

type PathArgumentStrategy = 'all_non_option_args' | 'skip_first_non_option_arg' | 'none'

const COMMAND_PATH_ARGUMENT_STRATEGIES: Partial<Record<string, PathArgumentStrategy>> = {
  echo: 'none',
  printf: 'none',
  git: 'none',
  node: 'none',
  python: 'none',
  python3: 'none',
  rg: 'skip_first_non_option_arg',
  grep: 'skip_first_non_option_arg',
  sed: 'skip_first_non_option_arg',
  'get-content': 'all_non_option_args',
  'get-childitem': 'all_non_option_args',
  'select-string': 'all_non_option_args',
  'copy-item': 'all_non_option_args',
  'move-item': 'all_non_option_args',
  'remove-item': 'all_non_option_args',
  'new-item': 'all_non_option_args',
  'set-content': 'all_non_option_args',
  'add-content': 'all_non_option_args',
  'out-file': 'all_non_option_args'
}

const isRedirectionOperator = (token: string): boolean =>
  token === '>' || token === '>>' || token === '1>' || token === '1>>'

const isRelativeEscapeToken = (token: string): boolean => {
  const normalized = String(token || '')
    .trim()
    .replace(/\\/g, '/')
  return (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')
  )
}

const collectBoundaryPathTokens = (tokens: string[]): string[] => {
  if (tokens.length <= 1) return []

  const command = String(tokens[0] || '').toLowerCase()
  const strategy = COMMAND_PATH_ARGUMENT_STRATEGIES[command] || 'all_non_option_args'
  const pathTokens: string[] = []
  let skippedNonOptionCount = 0

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue

    if (isRedirectionOperator(token)) {
      const next = tokens[index + 1]
      if (next && !next.startsWith('-')) {
        pathTokens.push(next)
        index += 1
      }
      continue
    }

    const inlineRedirection = token.match(/^(?:1?>>?)(.+)$/)
    if (inlineRedirection?.[1]) {
      pathTokens.push(inlineRedirection[1])
      continue
    }

    if (token.startsWith('-')) continue
    if (strategy === 'none') continue
    if (strategy === 'skip_first_non_option_arg' && skippedNonOptionCount === 0) {
      skippedNonOptionCount += 1
      continue
    }

    skippedNonOptionCount += 1
    pathTokens.push(token)
  }

  return pathTokens
}

export const checkWorkspaceBoundary = (
  command: string,
  rootPath: string
): { ok: true } | { ok: false; reason: string } => {
  if (!rootPath) {
    return { ok: false, reason: 'workspace root path is missing' }
  }

  const windowsStyle = getAiRuntimePlatform() === 'windows'

  for (const segment of parseShellCommandSegments(command, { windowsStyle })) {
    for (const candidatePath of collectBoundaryPathTokens(segment.tokens)) {
      if (isRelativeEscapeToken(candidatePath)) {
        return { ok: false, reason: `relative path escapes workspace boundary: ${candidatePath}` }
      }
      if (
        (candidatePath.startsWith('/') ||
          /^[a-z]:[\\/]/i.test(candidatePath) ||
          /^\\\\/.test(candidatePath)) &&
        !isPathInsideRoot(candidatePath, rootPath)
      ) {
        return { ok: false, reason: `path out of workspace boundary: ${candidatePath}` }
      }
    }
  }

  return { ok: true }
}

export const classifyCommandRisk = (command: string): 'low' | 'medium' | 'high' => {
  const text = String(command || '').toLowerCase()

  if (
    /\brm\s+-rf\b/.test(text) ||
    /\bremove-item\b/.test(text) ||
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
    /\bcopy-item\b/.test(text) ||
    /\bmove-item\b/.test(text) ||
    /\bnew-item\b/.test(text) ||
    /\bset-content\b/.test(text) ||
    /\badd-content\b/.test(text) ||
    /\bout-file\b/.test(text) ||
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
    /\bcopy-item\b/.test(text) ||
    /\bmove-item\b/.test(text) ||
    /\bremove-item\b/.test(text) ||
    /\bnew-item\b/.test(text) ||
    /\bset-content\b/.test(text) ||
    /\badd-content\b/.test(text) ||
    /\bout-file\b/.test(text) ||
    /\bgit\s+(add|commit|push|apply|am)\b/.test(text) ||
    /\btee\b/.test(text) ||
    />/.test(text)
  ) {
    return 'mutating'
  }

  if (
    /^\s*(cat|sed|head|tail|rg|grep|find|ls|pwd|stat|wc|get-content|get-childitem|select-string|git\s+status|git\s+diff|git\s+show|python\s+.*-c|python3\s+.*-c|node\s+.*-e)\b/.test(
      text
    )
  ) {
    return 'read_only'
  }

  return 'unknown'
}

export const analyzeTerminalCommand = (input: {
  command: string
  cwd?: string
}): TerminalCommandAnalysis => {
  const command = String(input.command || '').trim()
  const cwd = String(input.cwd || '').trim()

  return {
    riskLevel: classifyCommandRisk(command),
    commandMode: classifyCommandMode(command),
    resourceKey: cwd || 'workspace',
    artifactCandidates: collectTerminalArtifactCandidates(command)
  }
}

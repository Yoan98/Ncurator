import path from 'node:path'
import type { AiFileArtifactOperation } from '../../../../../shared/types'

export const isPathInsideRoot = (candidatePath: string, rootPath: string) => {
  const root = path.resolve(rootPath)
  const candidate = path.resolve(candidatePath)
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const parseShellTokens = (command: string): string[] => {
  const text = String(command || '')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
}

const parseAbsolutePathTokens = (command: string): string[] => {
  const tokens = parseShellTokens(command)
  return tokens.filter((token) => token.startsWith('/'))
}

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

  const absolutePaths = parseAbsolutePathTokens(text)
  for (const p of absolutePaths) {
    if (!isPathInsideRoot(p, rootPath)) {
      return { ok: false, reason: `path out of workspace boundary: ${p}` }
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

export type TerminalArtifactCandidate = {
  rawPath: string
  operation?: AiFileArtifactOperation
}

const splitSegments = (command: string): string[] => {
  return String(command || '')
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

const extractRedirectionPaths = (tokens: string[]): string[] => {
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === '>' || token === '>>' || token === '1>' || token === '1>>') {
      const next = tokens[i + 1]
      if (next && !next.startsWith('-')) paths.push(next)
      continue
    }
    const inline = token.match(/^(?:1?>>?)(.+)$/)
    if (inline?.[1]) {
      paths.push(inline[1])
    }
  }
  return paths
}

const pickNonOptionArgs = (tokens: string[]): string[] => {
  return tokens.filter((token, index) => index > 0 && token && !token.startsWith('-'))
}

const detectSegmentArtifacts = (segment: string): TerminalArtifactCandidate[] => {
  const tokens = parseShellTokens(segment)
  if (tokens.length === 0) return []

  const first = String(tokens[0] || '').toLowerCase()
  const candidates: TerminalArtifactCandidate[] = extractRedirectionPaths(tokens).map((rawPath) => ({
    rawPath
  }))
  const args = pickNonOptionArgs(tokens)

  if (first === 'touch' || first === 'mkdir') {
    for (const rawPath of args) candidates.push({ rawPath, operation: 'created' })
  } else if (first === 'cp' || first === 'mv') {
    const destination = args.at(-1)
    if (destination) {
      candidates.push({
        rawPath: destination,
        operation: first === 'mv' ? 'updated' : undefined
      })
    }
  } else if (first === 'tee') {
    const destination = args.find((token) => token !== '/dev/null')
    if (destination) candidates.push({ rawPath: destination })
  }

  return candidates
}

export const collectTerminalArtifactCandidates = (command: string): TerminalArtifactCandidate[] => {
  const unique = new Map<string, TerminalArtifactCandidate>()
  for (const segment of splitSegments(command)) {
    for (const candidate of detectSegmentArtifacts(segment)) {
      const key = candidate.rawPath.trim()
      if (!key) continue
      const previous = unique.get(key)
      if (!previous) {
        unique.set(key, candidate)
      } else if (!previous.operation && candidate.operation) {
        unique.set(key, candidate)
      }
    }
  }
  return Array.from(unique.values())
}

export const resolveWorkspacePath = (input: {
  rawPath: string
  cwd: string
  rootPath: string
}): string | null => {
  const raw = String(input.rawPath || '').trim()
  if (!raw) return null
  const base = raw.startsWith('/') ? raw : path.resolve(input.cwd, raw)
  const resolved = path.resolve(base)
  if (!isPathInsideRoot(resolved, input.rootPath)) return null
  return resolved
}

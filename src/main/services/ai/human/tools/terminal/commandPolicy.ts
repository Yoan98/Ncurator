import os from 'node:os'
import path from 'node:path'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'
import type {
  TerminalArtifactCandidate,
  TerminalCommandAnalysis,
  TerminalCommandSegment,
  TerminalRiskPolicyResult
} from './types'
import { analyzeTerminalRiskPolicy } from './policy/riskPolicy'
import {
  parseTerminalCommandSegments as parsePolicyCommandSegments,
  parseTerminalCommandTokens as parsePolicyCommandTokens
} from './policy/shellSyntax'

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
  'select-object': 'none',
  'select-string': 'all_non_option_args',
  'test-path': 'all_non_option_args',
  'resolve-path': 'all_non_option_args',
  'copy-item': 'all_non_option_args',
  'move-item': 'all_non_option_args',
  'remove-item': 'all_non_option_args',
  'new-item': 'all_non_option_args',
  'set-content': 'all_non_option_args',
  'add-content': 'all_non_option_args',
  'out-file': 'all_non_option_args'
}

const EXCEL_FILE_PATTERN = /\.(?:xlsx|xlsm|xltx|xltm)(?:['"\s;|&]|$)/i

export const isTerminalExcelMutationCommand = (command: string): boolean => {
  const normalized = String(command || '').trim()
  if (!EXCEL_FILE_PATTERN.test(normalized)) return false
  return (
    /(?:^|\s)(?:cp|mv|rm|touch|tee|sed|perl|python|python3|node|powershell|pwsh|rsync|set-content|add-content|out-file|copy-item|move-item|remove-item|set-cell|write|save|export|convert)(?:\s|$)/i.test(
      normalized
    ) || /(?:>|>>|\bopenpyxl\b|\bexceljs\b|\bwriteFile\b|\bwrite\b|\bsave\b)/i.test(normalized)
  )
}

const isWindowsPlatform = (platform?: AiRuntimePlatform): boolean =>
  (platform || getAiRuntimePlatform()) === 'windows'

export const parseTerminalCommandTokens = (
  command: string,
  options?: { windowsStyle?: boolean }
): string[] =>
  parsePolicyCommandTokens(command, {
    windowsStyle: options?.windowsStyle ?? isWindowsPlatform()
  })

export const parseTerminalCommandSegments = (
  command: string,
  options?: { windowsStyle?: boolean }
): TerminalCommandSegment[] =>
  parsePolicyCommandSegments(command, {
    windowsStyle: options?.windowsStyle ?? isWindowsPlatform()
  })

export const analyzeTerminalCommandPolicy = (
  command: string,
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalRiskPolicyResult => {
  const analysis = analyzeTerminalRiskPolicy(command, platform)
  return {
    executionPolicy: analysis.decision,
    decision: analysis.decision,
    matchedRuleId: analysis.matchedRuleIds.join('|') || undefined,
    reasonCode: analysis.reasonCode,
    reasons: analysis.reasons,
    reason: analysis.reason
  }
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

export const isPathInsideRoot = (candidatePath: string, rootPath: string) => {
  const useWindowsPaths =
    /^[a-z]:[\\/]/i.test(candidatePath) ||
    /^[a-z]:[\\/]/i.test(rootPath) ||
    /^\\\\/.test(candidatePath) ||
    /^\\\\/.test(rootPath)
  const pathApi = useWindowsPaths ? path.win32 : path
  const root = pathApi.resolve(rootPath)
  const candidate = pathApi.resolve(candidatePath)
  const rel = pathApi.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel))
}

export const isPathInsideAnyRoot = (candidatePath: string, rootPaths: readonly string[]): boolean =>
  rootPaths.some((rootPath) => isPathInsideRoot(candidatePath, rootPath))

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

export const checkWorkspaceBoundary = (
  command: string,
  rootPaths: string | readonly string[],
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): { ok: true } | { ok: false; reason: string } => {
  const allowedRootPaths = (Array.isArray(rootPaths) ? rootPaths : [rootPaths])
    .map((rootPath) => String(rootPath || '').trim())
    .filter(Boolean)
  if (allowedRootPaths.length === 0) {
    return { ok: false, reason: 'allowed root path is missing' }
  }

  for (const segment of parseTerminalCommandSegments(command, {
    windowsStyle: isWindowsPlatform(platform)
  })) {
    for (const candidatePath of collectBoundaryPathTokens(segment.tokens)) {
      if (isRelativeEscapeToken(candidatePath)) {
        return { ok: false, reason: `relative path escapes workspace boundary: ${candidatePath}` }
      }
      const expandedCandidatePath = /^~[\\/]/.test(candidatePath)
        ? path.join(os.homedir(), candidatePath.slice(2))
        : candidatePath
      if (
        (expandedCandidatePath.startsWith('/') ||
          /^[a-z]:[\\/]/i.test(expandedCandidatePath) ||
          /^\\\\/.test(expandedCandidatePath)) &&
        !isPathInsideAnyRoot(expandedCandidatePath, allowedRootPaths)
      ) {
        return { ok: false, reason: `path out of allowed boundary: ${candidatePath}` }
      }
    }
  }

  return { ok: true }
}

const extractRedirectionPaths = (tokens: string[]): string[] => {
  const paths: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (isRedirectionOperator(token)) {
      const next = tokens[index + 1]
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

const pickNonOptionArgs = (tokens: string[]): string[] =>
  tokens.filter((token, index) => index > 0 && token && !token.startsWith('-'))

const detectSegmentArtifacts = (tokens: string[]): TerminalArtifactCandidate[] => {
  if (tokens.length === 0) return []

  const first = String(tokens[0] || '').toLowerCase()
  const candidates: TerminalArtifactCandidate[] = extractRedirectionPaths(tokens).map(
    (rawPath) => ({
      rawPath
    })
  )
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
  } else if (first === 'copy-item' || first === 'move-item') {
    const destination = args.at(-1)
    if (destination) {
      candidates.push({
        rawPath: destination,
        operation: first === 'move-item' ? 'updated' : undefined
      })
    }
  } else if (first === 'new-item') {
    const destination = args.at(-1)
    if (destination) candidates.push({ rawPath: destination, operation: 'created' })
  } else if (first === 'set-content' || first === 'add-content' || first === 'out-file') {
    const destination = args.at(-1)
    if (destination) candidates.push({ rawPath: destination })
  } else if (first === 'tee') {
    const destination = args.find((token) => token !== '/dev/null')
    if (destination) candidates.push({ rawPath: destination })
  }

  return candidates
}

export const collectTerminalArtifactCandidates = (
  command: string,
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalArtifactCandidate[] => {
  const unique = new Map<string, TerminalArtifactCandidate>()
  for (const segment of parseTerminalCommandSegments(command, {
    windowsStyle: isWindowsPlatform(platform)
  })) {
    for (const candidate of detectSegmentArtifacts(segment.tokens)) {
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

export const analyzeTerminalCommand = (input: {
  command: string
  cwd?: string
  platform?: AiRuntimePlatform
}): TerminalCommandAnalysis => {
  const command = String(input.command || '').trim()
  const cwd = String(input.cwd || '').trim()

  return {
    resourceKey: cwd || 'workspace',
    artifactCandidates: collectTerminalArtifactCandidates(command, input.platform)
  }
}

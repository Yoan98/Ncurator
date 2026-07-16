import path from 'node:path'
import type { AiRuntimePlatform } from '../../../types'
import { getAiRuntimePlatform } from '../../../utils/platform'
import type {
  TerminalArtifactCandidate,
  TerminalCommandAnalysis,
  TerminalCommandSegment,
  TerminalSafePolicyResult
} from './types'

type PathArgumentStrategy = 'all_non_option_args' | 'skip_first_non_option_arg' | 'none'

type SafeCommandRule = {
  id: string
  guidance: string
  matches: (segment: { text: string; tokens: string[] }) => boolean
}

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

const readSegmentSeparator = (text: string, index: number): string | undefined => {
  const pair = text.slice(index, index + 2)
  if (pair === '&&' || pair === '||') return pair
  if (text[index] === ';' || text[index] === '|') return text[index]
  return undefined
}

const isWindowsPlatform = (platform?: AiRuntimePlatform): boolean =>
  (platform || getAiRuntimePlatform()) === 'windows'

export const parseTerminalCommandTokens = (
  command: string,
  options?: { windowsStyle?: boolean }
): string[] => {
  const text = String(command || '')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const windowsStyle = options?.windowsStyle ?? isWindowsPlatform()

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (!windowsStyle && char === '\\') {
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

export const parseTerminalCommandSegments = (
  command: string,
  options?: { windowsStyle?: boolean }
): TerminalCommandSegment[] => {
  const text = String(command || '')
  const segments: TerminalCommandSegment[] = []
  let quote: '"' | "'" | null = null
  let escaped = false
  let segmentStart = 0
  const windowsStyle = options?.windowsStyle ?? isWindowsPlatform()

  const pushSegment = (segmentText: string) => {
    const normalized = segmentText.trim()
    if (!normalized) return
    segments.push({
      text: normalized,
      tokens: parseTerminalCommandTokens(normalized, { windowsStyle })
    })
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (!windowsStyle && char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    const separator = readSegmentSeparator(text, index)
    if (!separator) continue

    pushSegment(text.slice(segmentStart, index))
    segmentStart = index + separator.length
    index += separator.length - 1
  }

  pushSegment(text.slice(segmentStart))
  return segments
}

const hasShellMetacharacters = (segmentText: string): boolean =>
  /(^|[^\\])(?:>>?|<|\(|\)|\$\(.*|`|&|\*)/.test(segmentText) || /\btee\b/i.test(segmentText)

const hasForbiddenToken = (tokens: readonly string[], forbidden: readonly string[]): boolean => {
  const normalized = tokens.map((token) => token.toLowerCase())
  return forbidden.some((token) => normalized.includes(token))
}

const isSimpleCommand = (
  tokens: readonly string[],
  commandNames: readonly string[],
  forbidden: readonly string[] = []
): boolean => {
  if (tokens.length === 0) return false
  const [head] = tokens
  if (!head || !commandNames.includes(head.toLowerCase())) return false
  return !hasForbiddenToken(tokens.slice(1), forbidden)
}

const isGitSafeCommand = (
  tokens: readonly string[],
  subcommand: 'status' | 'diff' | 'show'
): boolean => {
  if (tokens.length < 2) return false
  if (tokens[0].toLowerCase() !== 'git') return false
  if (tokens[1].toLowerCase() !== subcommand) return false
  return !hasForbiddenToken(tokens.slice(2), ['>', '>>'])
}

const isSafeFindCommand = (tokens: readonly string[]): boolean => {
  if (tokens.length === 0) return false
  if (tokens[0]?.toLowerCase() !== 'find') return false

  return !hasForbiddenToken(tokens.slice(1), [
    '-delete',
    '-exec',
    '-execdir',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls',
    '-ok',
    '-okdir'
  ])
}

const MACOS_SAFE_COMMAND_RULES: SafeCommandRule[] = [
  { id: 'pwd', guidance: '`pwd`', matches: ({ tokens }) => isSimpleCommand(tokens, ['pwd']) },
  { id: 'ls', guidance: '`ls`', matches: ({ tokens }) => isSimpleCommand(tokens, ['ls']) },
  { id: 'cat', guidance: '`cat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['cat']) },
  {
    id: 'strings',
    guidance: '`strings`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['strings'])
  },
  { id: 'head', guidance: '`head`', matches: ({ tokens }) => isSimpleCommand(tokens, ['head']) },
  { id: 'tail', guidance: '`tail`', matches: ({ tokens }) => isSimpleCommand(tokens, ['tail']) },
  { id: 'wc', guidance: '`wc`', matches: ({ tokens }) => isSimpleCommand(tokens, ['wc']) },
  { id: 'stat', guidance: '`stat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['stat']) },
  { id: 'echo', guidance: '`echo`', matches: ({ tokens }) => isSimpleCommand(tokens, ['echo']) },
  {
    id: 'printf',
    guidance: '`printf`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['printf'])
  },
  { id: 'find', guidance: '`find`', matches: ({ tokens }) => isSafeFindCommand(tokens) },
  { id: 'rg', guidance: '`rg`', matches: ({ tokens }) => isSimpleCommand(tokens, ['rg']) },
  { id: 'grep', guidance: '`grep`', matches: ({ tokens }) => isSimpleCommand(tokens, ['grep']) },
  {
    id: 'git-status',
    guidance: '`git status`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'status')
  },
  {
    id: 'git-diff',
    guidance: '`git diff`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'diff')
  },
  {
    id: 'git-show',
    guidance: '`git show`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'show')
  }
]

const WINDOWS_SAFE_COMMAND_RULES: SafeCommandRule[] = [
  {
    id: 'get-location',
    guidance: '`Get-Location`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-location'])
  },
  {
    id: 'get-childitem',
    guidance: '`Get-ChildItem`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-childitem'])
  },
  {
    id: 'get-content',
    guidance: '`Get-Content`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-content'])
  },
  {
    id: 'select-string',
    guidance: '`Select-String`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['select-string'])
  },
  {
    id: 'test-path',
    guidance: '`Test-Path`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['test-path'])
  },
  {
    id: 'resolve-path',
    guidance: '`Resolve-Path`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['resolve-path'])
  },
  {
    id: 'write-output',
    guidance: '`Write-Output`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['write-output'])
  },
  {
    id: 'git-status',
    guidance: '`git status`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'status')
  },
  {
    id: 'git-diff',
    guidance: '`git diff`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'diff')
  },
  {
    id: 'git-show',
    guidance: '`git show`',
    matches: ({ tokens }) => isGitSafeCommand(tokens, 'show')
  }
]

export const getSafeCommandRules = (platform: AiRuntimePlatform): readonly SafeCommandRule[] =>
  platform === 'windows' ? WINDOWS_SAFE_COMMAND_RULES : MACOS_SAFE_COMMAND_RULES

export const getSafeCommandGuidance = (platform: AiRuntimePlatform): string =>
  getSafeCommandRules(platform)
    .map((rule) => rule.guidance)
    .join('、')

const findSafeCommandRule = (
  segment: { text: string; tokens: string[] },
  platform: AiRuntimePlatform
): SafeCommandRule | undefined => {
  if (hasShellMetacharacters(segment.text)) return undefined
  return getSafeCommandRules(platform).find((rule) => rule.matches(segment))
}

export const analyzeSafeTerminalCommandPolicy = (
  command: string,
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): TerminalSafePolicyResult => {
  const text = String(command || '').trim()
  if (!text) {
    return {
      executionPolicy: 'approval_required',
      reason: 'empty command is not allowed'
    }
  }

  const segments = parseTerminalCommandSegments(text, {
    windowsStyle: isWindowsPlatform(platform)
  })
  if (segments.length === 0) {
    return {
      executionPolicy: 'approval_required',
      reason: 'empty command is not allowed'
    }
  }

  const matchedRuleIds: string[] = []
  for (const segment of segments) {
    const matchedRule = findSafeCommandRule(segment, platform)
    if (!matchedRule) {
      return {
        executionPolicy: 'approval_required',
        reason: 'command is outside the current platform safe command set'
      }
    }
    matchedRuleIds.push(matchedRule.id)
  }

  return {
    executionPolicy: 'safe_allowed',
    matchedRuleId: matchedRuleIds.join('|'),
    reason: `matched safe command rule ${matchedRuleIds.join('|')}`
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
  const root = path.resolve(rootPath)
  const candidate = path.resolve(candidatePath)
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
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

export const checkWorkspaceBoundary = (
  command: string,
  rootPath: string,
  platform: AiRuntimePlatform = getAiRuntimePlatform()
): { ok: true } | { ok: false; reason: string } => {
  if (!rootPath) {
    return { ok: false, reason: 'workspace root path is missing' }
  }

  for (const segment of parseTerminalCommandSegments(command, {
    windowsStyle: isWindowsPlatform(platform)
  })) {
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

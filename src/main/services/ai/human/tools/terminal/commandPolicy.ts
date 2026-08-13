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

export const resolveToolPath = (input: {
  rawPath: string
  cwd: string
}): string | null => {
  const raw = String(input.rawPath || '').trim()
  if (!raw) return null
  const base = path.isAbsolute(raw) ? raw : path.resolve(input.cwd, raw)
  return path.resolve(base)
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

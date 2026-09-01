import fs from 'node:fs'
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

const TERMINATION_COMMAND_WORDS = new Set([
  'kill',
  'pkill',
  'killall',
  'taskkill',
  'stop-process',
  'stop-job',
  'stop-service'
])

// 终止类命令：在并发终端达到上限时允许放行，供模型腾出已占用的终端位置。
// 只在命令的第一个 token 匹配时生效，避免 `echo pkill` 之类的误判。
export const isTerminalTerminationCommand = (command: string): boolean => {
  const tokens = parseTerminalCommandTokens(command)
  const first = tokens[0]?.toLowerCase()
  return first !== undefined && TERMINATION_COMMAND_WORDS.has(first)
}

// 直接读写文件的命令（cp/mv/rm/...），参数或目标含 xlsx 时视为变更。
const EXCEL_FILE_COMMAND_WORDS =
  /(?:^|\s)(?:cp|mv|rm|touch|tee|sed|rsync|convert|set-content|add-content|out-file|copy-item|move-item|remove-item)(?:\s|$)/i

// 显式写入/导出动作词。
const EXCEL_WRITE_ACTION_WORDS = /(?:^|\s)(?:set-cell|write|save|export)(?:\s|$)/i

// 运行脚本的解释器：外部脚本看不到内容，把 xlsx 作为参数时保守拦截；
// 内联执行（-c/-e/heredoc）则改为检查代码内是否出现写 Excel 的 API。
const EXCEL_SCRIPT_INTERPRETER_WORDS =
  /(?:^|\s)(?:python|python3|node|perl|powershell|pwsh)(?:\s|$)/i

// 内联代码执行：`python3 -c "..."`、`node -e "..."`、heredoc `<<'EOF'`。
const INLINE_CODE_EXECUTION =
  /(?:python|python3|node|perl|powershell|pwsh)\b[^\n]*\s-[ce]\b|<<\s*['"]?[A-Za-z_]*['"]?/i

// 内联代码中显式写 Excel 的 API。
const EXCEL_INLINE_WRITE_API =
  /\.save\s*\(|to_excel\s*\(|xlsxwriter|exceljs|writeFile(?:Sync)?\s*\(/i

export const isTerminalExcelMutationCommand = (command: string): boolean => {
  const normalized = String(command || '').trim()
  if (!EXCEL_FILE_PATTERN.test(normalized)) return false
  if (INLINE_CODE_EXECUTION.test(normalized)) {
    return EXCEL_INLINE_WRITE_API.test(normalized)
  }
  if (/>/.test(normalized)) return true
  if (EXCEL_FILE_COMMAND_WORDS.test(normalized)) return true
  if (EXCEL_WRITE_ACTION_WORDS.test(normalized)) return true
  return EXCEL_SCRIPT_INTERPRETER_WORDS.test(normalized)
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

export const hasDetachedExecution = (
  command: string,
  platform: AiRuntimePlatform
): boolean => {
  const tokens = parseTerminalCommandTokens(command, { windowsStyle: platform === 'windows' })
  if (tokens.some((token) => /^(nohup|start-process)$/i.test(token))) return true
  if (platform === 'windows') return false

  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '&') {
      const prev = command[index - 1]
      const next = command[index + 1]
      if (prev === '&' || next === '&') continue
      if (prev === '>' || prev === '<' || next === '>') continue
      return true
    }
  }
  return false
}

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

const realPathCache = new Map<string, string>()

const realpathNearestExisting = (value: string, pathApi: typeof path): string => {
  const cached = realPathCache.get(value)
  if (cached) return cached
  let resolved: string
  try {
    resolved = fs.realpathSync.native(value)
  } catch {
    const parent = pathApi.dirname(value)
    if (parent === value) return value
    resolved = pathApi.join(realpathNearestExisting(parent, pathApi), pathApi.basename(value))
  }
  realPathCache.set(value, resolved)
  return resolved
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
  if (rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel))) return true

  const resolvedRoot = realpathNearestExisting(root, pathApi)
  const resolvedCandidate = realpathNearestExisting(candidate, pathApi)
  const resolvedRel = pathApi.relative(resolvedRoot, resolvedCandidate)
  return resolvedRel === '' || (!resolvedRel.startsWith('..') && !pathApi.isAbsolute(resolvedRel))
}

export const resolveToolPath = (rawPath: string): string | null => {
  const raw = String(rawPath || '').trim()
  if (!raw || !path.isAbsolute(raw)) return null
  return path.resolve(raw)
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

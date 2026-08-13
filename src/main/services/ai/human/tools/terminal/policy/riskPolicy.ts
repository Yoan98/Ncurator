import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalCommandSegment } from '../types'
import {
  extractEmbeddedShellPayloads,
  findUnsafeShellSyntax,
  parseTerminalCommandSegments
} from './shellSyntax'
import { buildDangerousCommandRules, isDangerousCommandName, normalizeCommandName } from './dangerousRules'
import type { DangerousCommandRule, TerminalRiskAnalysis, TerminalRiskReason } from './types'

const dynamicSyntaxReason = (syntax: string): TerminalRiskReason | undefined => {
  if (syntax === 'redirection') return 'shell_redirection'
  if (syntax === 'unclosed_quote') return 'parse_uncertain'
  return undefined
}

const evaluateSegment = (
  segment: TerminalCommandSegment,
  platform: AiRuntimePlatform,
  rules: readonly DangerousCommandRule[]
): Array<{ ruleId: string; reason: TerminalRiskReason }> => {
  const matches = rules
    .filter((rule) => rule.matches(segment))
    .map((rule) => ({ ruleId: rule.id, reason: rule.reasonCode }))

  const syntax = findUnsafeShellSyntax(segment.text, platform)
  const syntaxReason = syntax ? dynamicSyntaxReason(syntax) : undefined
  if (syntaxReason) matches.push({ ruleId: `syntax-${syntax}`, reason: syntaxReason })
  return matches
}

const isShellName = (value: string): boolean =>
  [
    'cmd',
    'cmd.exe',
    'powershell',
    'powershell.exe',
    'pwsh',
    'pwsh.exe',
    'sh',
    'bash',
    'zsh',
    'dash',
    'fish'
  ].includes(normalizeCommandName(value))

const SHELL_KEYWORD_NAMES = new Set([
  'if',
  'then',
  'else',
  'elseif',
  'elif',
  'fi',
  'for',
  'foreach',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'select',
  'switch',
  'function',
  'filter',
  'try',
  'catch',
  'finally',
  'trap',
  'begin',
  'process',
  'end',
  'time'
])

const extractNestedPayloads = (
  segment: TerminalCommandSegment,
  platform: AiRuntimePlatform
): string[] => {
  const command = normalizeCommandName(segment.tokens[0] || '')
  const tokens = segment.tokens
  const payloads: string[] = []

  if (isShellName(command)) {
    const optionIndex = tokens.findIndex((token) => {
      const normalized = token.toLowerCase()
      return (
        normalized === '/c' ||
        normalized === '/k' ||
        normalized === '-c' ||
        normalized.startsWith('-command') ||
        normalized.startsWith('-encoded') ||
        normalized === '--eval' ||
        normalized === '-e'
      )
    })
    if (optionIndex >= 0 && !tokens[optionIndex].toLowerCase().startsWith('-encoded')) {
      const payload = tokens
        .slice(optionIndex + 1)
        .join(' ')
        .trim()
      if (payload) payloads.push(payload)
    }
  }

  if (command === 'start-process' || command === 'start') {
    const target = tokens.slice(1).find((token) => isShellName(token))
    const argumentIndex = tokens.findIndex((token) => token.toLowerCase() === '-argumentlist')
    if (target && argumentIndex >= 0) {
      const payload = `${target} ${tokens.slice(argumentIndex + 1).join(' ')}`.trim()
      if (payload) payloads.push(payload)
    }
  }

  if (['invoke-expression', 'iex', 'eval', 'exec'].includes(command)) {
    const payload = tokens.slice(1).join(' ').trim()
    if (payload) payloads.push(payload)
  }

  if (SHELL_KEYWORD_NAMES.has(command) && tokens.length > 1) {
    const rest = tokens.slice(1)
    const payload = rest.join(' ').trim()
    if (payload) payloads.push(payload)
    for (let index = 0; index < rest.length; index += 1) {
      if (!isDangerousCommandName(normalizeCommandName(rest[index]))) continue
      const tail = rest.slice(index).join(' ').trim()
      if (tail && tail !== payload) payloads.push(tail)
    }
  }

  payloads.push(...extractEmbeddedShellPayloads(segment.text, platform))

  return payloads
}

const collectRiskMatches = (
  command: string,
  platform: AiRuntimePlatform,
  rules: readonly DangerousCommandRule[],
  depth = 0
): Array<{ ruleId: string; reason: TerminalRiskReason }> => {
  if (depth > 4) return []
  const segments = parseTerminalCommandSegments(command, { windowsStyle: platform === 'windows' })
  return segments.flatMap((segment) => {
    const directMatches = evaluateSegment(segment, platform, rules)
    const nestedMatches = extractNestedPayloads(segment, platform).flatMap((payload) =>
      collectRiskMatches(payload, platform, rules, depth + 1).map((match) => ({
        ruleId: `nested:${match.ruleId}`,
        reason: match.reason
      }))
    )
    return [...directMatches, ...nestedMatches]
  })
}

export const analyzeTerminalRiskPolicy = (
  command: string,
  platform: AiRuntimePlatform
): TerminalRiskAnalysis => {
  const text = String(command || '').trim()
  if (!text) {
    return {
      decision: 'approval_required',
      matchedRuleIds: [],
      reasons: ['parse_uncertain'],
      reasonCode: 'parse_uncertain',
      reason: 'empty command cannot be analyzed'
    }
  }

  const segments = parseTerminalCommandSegments(text, { windowsStyle: platform === 'windows' })
  if (segments.length === 0) {
    return {
      decision: 'approval_required',
      matchedRuleIds: [],
      reasons: ['parse_uncertain'],
      reasonCode: 'parse_uncertain',
      reason: 'command could not be parsed'
    }
  }

  const rules = buildDangerousCommandRules()
  const matches = collectRiskMatches(text, platform, rules)
  const matchedRuleIds = Array.from(new Set(matches.map((match) => match.ruleId)))
  const reasons = Array.from(new Set(matches.map((match) => match.reason)))

  if (matches.length === 0) {
    return {
      decision: 'auto_allow',
      matchedRuleIds: [],
      reasons: [],
      reasonCode: 'none',
      reason: 'no dangerous terminal rule matched'
    }
  }

  const reasonCode = reasons[0] || 'parse_uncertain'
  return {
    decision: 'approval_required',
    matchedRuleIds,
    reasons,
    reasonCode,
    reason: `dangerous terminal rule matched: ${matchedRuleIds.join('|')}`
  }
}

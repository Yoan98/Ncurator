import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalCommandSegment } from '../types'
import { findUnsafeShellSyntax, parseTerminalCommandSegments } from './shellSyntax'
import { buildDangerousCommandRules } from './dangerousRules'
import type { DangerousCommandRule, TerminalRiskAnalysis, TerminalRiskReason } from './types'

const dynamicSyntaxReason = (syntax: string): TerminalRiskReason | undefined => {
  if (syntax === 'redirection') return 'shell_redirection'
  if (
    syntax === 'command_substitution' ||
    syntax === 'powershell_escape_or_command_substitution' ||
    syntax === 'dynamic_expression'
  ) {
    return 'inline_code_execution'
  }
  if (syntax === 'background_or_invocation_operator') return 'nested_shell_execution'
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
  const matches = segments.flatMap((segment) => evaluateSegment(segment, platform, rules))
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

export const getDangerousCommandRules = (): readonly DangerousCommandRule[] =>
  buildDangerousCommandRules()

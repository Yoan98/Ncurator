import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalCommandSegment } from '../types'
import { MACOS_MUTATING_COMMANDS, MACOS_READONLY_COMMAND_RULES } from './macosReadonlyRules'
import { findUnsafeShellSyntax, parseTerminalCommandSegments } from './shellSyntax'
import type { ReadonlyCommandRule, TerminalEffectAnalysis } from './types'
import { WINDOWS_MUTATING_COMMANDS, WINDOWS_READONLY_COMMAND_RULES } from './windowsReadonlyRules'

export const getReadonlyCommandRules = (
  platform: AiRuntimePlatform
): readonly ReadonlyCommandRule[] =>
  platform === 'windows' ? WINDOWS_READONLY_COMMAND_RULES : MACOS_READONLY_COMMAND_RULES

export const getReadonlyCommandGuidance = (platform: AiRuntimePlatform): string =>
  getReadonlyCommandRules(platform)
    .map((rule) => rule.guidance)
    .join(', ')

const findReadonlyRule = (
  segment: TerminalCommandSegment,
  platform: AiRuntimePlatform
): ReadonlyCommandRule | undefined =>
  getReadonlyCommandRules(platform).find((rule) => rule.matches(segment))

const isKnownMutatingCommand = (
  segment: TerminalCommandSegment,
  platform: AiRuntimePlatform
): boolean => {
  const command = segment.tokens[0]?.toLowerCase()
  if (!command) return false
  return (platform === 'windows' ? WINDOWS_MUTATING_COMMANDS : MACOS_MUTATING_COMMANDS).has(command)
}

export const analyzeTerminalCommandEffect = (
  command: string,
  platform: AiRuntimePlatform
): TerminalEffectAnalysis => {
  const text = String(command || '').trim()
  if (!text) {
    return {
      effect: 'unknown',
      matchedRuleIds: [],
      reasonCode: 'empty_command',
      reason: 'empty command is not allowed'
    }
  }

  const segments = parseTerminalCommandSegments(text, { windowsStyle: platform === 'windows' })
  if (segments.length === 0) {
    return {
      effect: 'unknown',
      matchedRuleIds: [],
      reasonCode: 'empty_command',
      reason: 'empty command is not allowed'
    }
  }

  const matchedRuleIds: string[] = []
  let hasUnknownSegment = false
  let unknownReasonCode = 'unknown_command'

  for (const segment of segments) {
    const unsafeSyntax = findUnsafeShellSyntax(segment.text, platform)
    if (unsafeSyntax) {
      if (unsafeSyntax === 'redirection') {
        return {
          effect: 'mutating',
          matchedRuleIds,
          reasonCode: 'output_redirection',
          reason: 'command writes through shell redirection'
        }
      }
      hasUnknownSegment = true
      unknownReasonCode = unsafeSyntax
      continue
    }

    const matchedRule = findReadonlyRule(segment, platform)
    if (matchedRule) {
      matchedRuleIds.push(matchedRule.id)
      continue
    }

    if (isKnownMutatingCommand(segment, platform)) {
      return {
        effect: 'mutating',
        matchedRuleIds,
        reasonCode: 'known_mutating_command',
        reason: `command has known mutating segment: ${segment.tokens[0]}`
      }
    }

    hasUnknownSegment = true
  }

  if (hasUnknownSegment) {
    return {
      effect: 'unknown',
      matchedRuleIds,
      reasonCode: unknownReasonCode,
      reason: `command cannot be confirmed read-only: ${unknownReasonCode}`
    }
  }

  return {
    effect: 'read_only',
    matchedRuleIds,
    reasonCode: 'matched_readonly_rules',
    reason: `matched read-only command rules ${matchedRuleIds.join('|')}`
  }
}

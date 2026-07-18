import type { TerminalCommandSegment } from '../types'

export type TerminalDecision = 'auto_allow' | 'approval_required'

export type TerminalRiskReason =
  | 'destructive_command'
  | 'dangerous_argument'
  | 'file_write'
  | 'shell_redirection'
  | 'inline_code_execution'
  | 'nested_shell_execution'
  | 'privilege_or_process_control'
  | 'parse_uncertain'

export type DangerousCommandRule = {
  id: string
  reasonCode: TerminalRiskReason
  description: string
  guidance?: string
  matches: (segment: TerminalCommandSegment) => boolean
}

export type TerminalRiskAnalysis = {
  decision: TerminalDecision
  matchedRuleIds: string[]
  reasons: TerminalRiskReason[]
  reasonCode: TerminalRiskReason | 'none'
  reason: string
}

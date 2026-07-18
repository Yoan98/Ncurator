import type { TerminalCommandSegment } from '../types'

export type TerminalCommandEffect = 'read_only' | 'mutating' | 'unknown'

export type ReadonlyCommandRule = {
  id: string
  guidance: string
  matches: (segment: TerminalCommandSegment) => boolean
}

export type TerminalEffectAnalysis = {
  effect: TerminalCommandEffect
  matchedRuleIds: string[]
  reasonCode: string
  reason: string
}

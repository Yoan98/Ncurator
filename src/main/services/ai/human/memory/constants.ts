import {
  HUMAN_MAX_RECENT_HISTORY_ROUNDS,
  HUMAN_MAX_ROUND_HISTORY
} from '../constants'

export const HUMAN_HISTORY_LIMITS = {
  roundHistory: HUMAN_MAX_ROUND_HISTORY,
  recentHistoryRounds: HUMAN_MAX_RECENT_HISTORY_ROUNDS
} as const

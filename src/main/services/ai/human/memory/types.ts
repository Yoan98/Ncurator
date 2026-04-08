import type {
  HumanLoadedHistoryContext,
  HumanMemoryHistory,
  HumanRoundExecution,
  HumanRoundRecord,
  HumanStableMemory,
  HumanWatchHint
} from '../types'

export type HumanHistoryLoadedContext = NonNullable<HumanLoadedHistoryContext>
export type HumanHistoryRecord = HumanRoundRecord
export type HumanHistoryExecution = HumanRoundExecution
export type HumanHistoryHint = HumanWatchHint
export type HumanProcessMemory = HumanMemoryHistory
export type HumanTaskStableMemory = HumanStableMemory

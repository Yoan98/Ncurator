import type {
  HumanLoadedHistoryContext,
  HumanRoundExecution,
  HumanRoundRecord,
  HumanState,
  HumanWatchHint
} from '../types'

export type HumanStableMemory = HumanState['brainMemory']['inside']
export type HumanProcessMemory = HumanState['processMemory']
export type HumanHistoryLoadedContext = NonNullable<HumanLoadedHistoryContext>
export type HumanHistoryRecord = HumanRoundRecord
export type HumanHistoryExecution = HumanRoundExecution
export type HumanHistoryHint = HumanWatchHint

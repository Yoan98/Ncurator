export type WatchdogSidecarState = {
  startedAt: number
  repeatedActionBatchCount: number
  stagnantCount: number
  focusChurnCount: number
  lastActionBatchSignature?: string
  lastFocus?: string
  lastFactCount: number
  lastIncomingSummary?: string
  softWarnings: number
  hardRequested: boolean
}

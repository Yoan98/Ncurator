import type { DocxReplaySession } from '../types'

export type RunDraftDocument = {
  sourcePath: string
  sourceName: string
  latestDocId: string
  dirtyChangeCount: number
  replaySession?: DocxReplaySession
}

export type ResolvedDocxOpenTarget = {
  openPath: string
  trackedSourcePath: string
}

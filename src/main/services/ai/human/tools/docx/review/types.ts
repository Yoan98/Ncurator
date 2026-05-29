import type { DocxReplaySession } from '../types'

export type RunDocxEditDocument = {
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

import type { DocxEditSession } from '../types'

export type RunDocxEditDocument = {
  sourcePath: string
  sourceName: string
  latestDocId: string
  dirty: boolean
  editSession?: DocxEditSession
}

export type ResolvedDocxOpenTarget = {
  openPath: string
  trackedSourcePath: string
}

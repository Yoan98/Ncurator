import type { DraftReviewChange, JsonObject } from '../../../../../../../shared/types'

export type RunDraftChangeSeed = {
  id: string
  orderIndex: number
  changeKind: DraftReviewChange['change_kind']
  title: string
  summary: string
  beforeText: string
  afterText: string
  locator: JsonObject
  metadata: JsonObject
}

export type RunDraftDocument = {
  sourcePath: string
  sourceName: string
  initialDocId: string
  latestDocId: string
  previewArtifactPath?: string
  changes: RunDraftChangeSeed[]
}

export type RunDraftState = {
  sessionId: string
  inputText: string
  documentBySourcePath: Map<string, RunDraftDocument>
  sourcePathByDocId: Map<string, string>
  orderCounter: number
}

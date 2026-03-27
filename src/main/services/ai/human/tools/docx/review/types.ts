import type { DraftChangeKind, DraftReviewChange, DraftSourceVersion, JsonObject } from '../../../../../../../shared/types'
import type { DocxOp } from '../types'

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
  anchorName: string
  docxOp: DocxOp
}

export type RunDraftDocument = {
  sourcePath: string
  sourceName: string
  latestDocId: string
  dirtyChangeCount: number
}

export type DocxConfirmManifestChange = {
  change_id: string
  order_index: number
  change_kind: DraftChangeKind
  anchor_name: string
  block_id?: string
  action?: string
}

export type DocxConfirmManifest = {
  version: number
  review_id: string
  source_path: string
  source_name: string
  source_version: DraftSourceVersion
  latest_draft_snapshot_id: string
  created_at: number
  change_count: number
  changes: DocxConfirmManifestChange[]
}

export type ResolvedDocxOpenTarget = {
  openPath: string
  trackedSourcePath: string
}

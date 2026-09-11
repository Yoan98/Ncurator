import type { Migration } from './types'

export const resetResumeSnapshotsV2Migration: Migration = {
  version: 4,
  name: 'reset_resume_snapshots_v2',
  sql: `DELETE FROM chat_session_resume_snapshot;`
}

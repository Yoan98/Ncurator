import type {
  WorkspaceIndexJobAction,
  WorkspaceIndexJobPhase,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobSourceKind,
  WorkspaceIndexJobStatus
} from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  insertOrReplace,
  jsonStringify,
  omitUndefined,
  parseJsonArray,
  toOptionalNumber,
  toOptionalString,
  toRequiredNumber,
  toRequiredString
} from '../sqlite/sqliteUtils'

type WorkspaceIndexJobRow = Record<string, unknown>

const normalizeSourceKind = (value: unknown): WorkspaceIndexJobSourceKind =>
  String(value ?? '').trim() === 'web' ? 'web' : 'file'

const normalizeAction = (value: unknown): WorkspaceIndexJobAction =>
  String(value ?? '').trim() === 'scan' ? 'scan' : 'prepare'

const normalizeStatus = (value: unknown): WorkspaceIndexJobStatus => {
  const next = String(value ?? '').trim()
  if (next === 'succeeded' || next === 'failed' || next === 'cancelled') return next
  return 'running'
}

const normalizePhase = (value: unknown): WorkspaceIndexJobPhase => {
  const next = String(value ?? '').trim()
  if (next === 'diff' || next === 'crawl' || next === 'index' || next === 'complete') return next
  return 'scan'
}

const toWorkspaceIndexJobRecord = (row: WorkspaceIndexJobRow): WorkspaceIndexJobRecord => ({
  id: toRequiredString(row.id),
  workspace_id: toRequiredString(row.workspace_id),
  source_kind: normalizeSourceKind(row.source_kind),
  action: normalizeAction(row.action),
  status: normalizeStatus(row.status),
  phase: normalizePhase(row.phase),
  step_index: toRequiredNumber(row.step_index, 1),
  step_total: toRequiredNumber(row.step_total, 1),
  total_count: toRequiredNumber(row.total_count),
  processed_count: toRequiredNumber(row.processed_count),
  failed_count: toRequiredNumber(row.failed_count),
  target_ids: parseJsonArray<string>(row.target_ids_json) || [],
  message: toOptionalString(row.message),
  last_error: toOptionalString(row.last_error),
  started_at: toRequiredNumber(row.started_at),
  updated_at: toRequiredNumber(row.updated_at),
  finished_at: toOptionalNumber(row.finished_at)
})

const toWriteRow = (job: WorkspaceIndexJobRecord) => ({
  id: job.id,
  workspace_id: job.workspace_id,
  source_kind: job.source_kind,
  action: job.action,
  status: job.status,
  phase: job.phase,
  step_index: job.step_index,
  step_total: job.step_total,
  total_count: job.total_count,
  processed_count: job.processed_count,
  failed_count: job.failed_count,
  target_ids_json: jsonStringify(job.target_ids) || '[]',
  message: job.message,
  last_error: job.last_error,
  started_at: job.started_at,
  updated_at: job.updated_at,
  finished_at: job.finished_at
})

export class WorkspaceIndexJobStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveJob(job: WorkspaceIndexJobRecord): Promise<void> {
    insertOrReplace(this.sqlite, 'workspace_index_job', toWriteRow(job))
  }

  public async updateJob(
    id: string,
    values: Partial<
      Pick<
        WorkspaceIndexJobRecord,
        | 'status'
        | 'phase'
        | 'step_index'
        | 'step_total'
        | 'total_count'
        | 'processed_count'
        | 'failed_count'
        | 'target_ids'
        | 'message'
        | 'last_error'
        | 'updated_at'
        | 'finished_at'
      >
    >
  ): Promise<void> {
    const next = omitUndefined({
      status: values.status,
      phase: values.phase,
      step_index: values.step_index,
      step_total: values.step_total,
      total_count: values.total_count,
      processed_count: values.processed_count,
      failed_count: values.failed_count,
      target_ids_json: values.target_ids ? JSON.stringify(values.target_ids) : undefined,
      message: values.message,
      last_error: values.last_error,
      updated_at: values.updated_at,
      finished_at: values.finished_at
    })
    const columns = Object.keys(next)
    if (columns.length === 0) return
    const assignments = columns.map((column) => `${column} = @${column}`)
    this.sqlite
      .prepare(
        `UPDATE workspace_index_job SET ${assignments.join(', ')}
         WHERE id = @id AND status = 'running'`
      )
      .run({ ...next, id })
  }

  public async getJobById(id: string): Promise<WorkspaceIndexJobRecord | null> {
    const row = this.sqlite.prepare('SELECT * FROM workspace_index_job WHERE id = ?').get(id) as
      | WorkspaceIndexJobRow
      | undefined
    return row ? toWorkspaceIndexJobRecord(row) : null
  }

  public async getActiveJob(
    workspaceId: string,
    sourceKind: WorkspaceIndexJobSourceKind
  ): Promise<WorkspaceIndexJobRecord | null> {
    const row = this.sqlite
      .prepare(
        `
        SELECT * FROM workspace_index_job
        WHERE workspace_id = ? AND source_kind = ? AND status = 'running'
        ORDER BY started_at DESC
        LIMIT 1
      `
      )
      .get(workspaceId, sourceKind) as WorkspaceIndexJobRow | undefined
    return row ? toWorkspaceIndexJobRecord(row) : null
  }

  public async listRunningJobs(): Promise<WorkspaceIndexJobRecord[]> {
    const rows = this.sqlite
      .prepare("SELECT * FROM workspace_index_job WHERE status = 'running' ORDER BY started_at ASC")
      .all() as WorkspaceIndexJobRow[]
    return rows.map(toWorkspaceIndexJobRecord)
  }

  public async hasRunningPrepareJob(): Promise<boolean> {
    const row = this.sqlite
      .prepare(
        "SELECT 1 FROM workspace_index_job WHERE status = 'running' AND action = 'prepare' LIMIT 1"
      )
      .get()
    return Boolean(row)
  }

  public async failRunningJobs(message: string, now = Date.now()): Promise<number> {
    const result = this.sqlite
      .prepare(
        `
        UPDATE workspace_index_job
        SET status = 'failed', message = @message, last_error = @message,
            updated_at = @now, finished_at = @now
        WHERE status = 'running'
      `
      )
      .run({ message, now })
    return result.changes
  }
}

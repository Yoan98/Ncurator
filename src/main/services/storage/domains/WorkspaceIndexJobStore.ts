import type {
  WorkspaceIndexJobAction,
  WorkspaceIndexJobPhase,
  WorkspaceIndexJobRecord,
  WorkspaceIndexJobSourceKind,
  WorkspaceIndexJobStatus
} from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type PrimitiveRowValue = string | number | boolean | null | undefined
type WorkspaceIndexJobWriteRow = Record<string, PrimitiveRowValue>

type WorkspaceIndexJobRow = {
  id?: PrimitiveRowValue
  workspace_id?: PrimitiveRowValue
  source_kind?: PrimitiveRowValue
  action?: PrimitiveRowValue
  status?: PrimitiveRowValue
  phase?: PrimitiveRowValue
  step_index?: PrimitiveRowValue
  step_total?: PrimitiveRowValue
  total_count?: PrimitiveRowValue
  processed_count?: PrimitiveRowValue
  failed_count?: PrimitiveRowValue
  target_ids_json?: PrimitiveRowValue
  message?: PrimitiveRowValue
  last_error?: PrimitiveRowValue
  started_at?: PrimitiveRowValue
  updated_at?: PrimitiveRowValue
  finished_at?: PrimitiveRowValue
}

const toOptionalString = (value: PrimitiveRowValue): string | undefined => {
  if (value == null) return undefined
  const next = String(value).trim()
  return next.length > 0 ? next : undefined
}

const toRequiredString = (value: PrimitiveRowValue): string => String(value ?? '')

const toRequiredNumber = (value: PrimitiveRowValue, fallback = 0): number => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

const toOptionalNumber = (value: PrimitiveRowValue): number | undefined => {
  if (value == null) return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

const normalizeSourceKind = (value: PrimitiveRowValue): WorkspaceIndexJobSourceKind =>
  String(value ?? '').trim() === 'web' ? 'web' : 'file'

const normalizeAction = (value: PrimitiveRowValue): WorkspaceIndexJobAction =>
  String(value ?? '').trim() === 'scan' ? 'scan' : 'prepare'

const normalizeStatus = (value: PrimitiveRowValue): WorkspaceIndexJobStatus => {
  const next = String(value ?? '').trim()
  return next === 'succeeded' || next === 'failed' ? next : 'running'
}

const normalizePhase = (value: PrimitiveRowValue): WorkspaceIndexJobPhase => {
  const next = String(value ?? '').trim()
  if (next === 'crawl' || next === 'index' || next === 'complete') return next
  return 'scan'
}

const parseTargetIds = (value: PrimitiveRowValue): string[] => {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as string[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

const stringifyTargetIds = (value: string[]): string => JSON.stringify(value)

const omitUndefined = <T extends Record<string, PrimitiveRowValue>>(value: T): Partial<T> => {
  const next: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) {
      next[key] = value[key]
    }
  }
  return next
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
  target_ids: parseTargetIds(row.target_ids_json),
  message: toOptionalString(row.message),
  last_error: toOptionalString(row.last_error),
  started_at: toRequiredNumber(row.started_at),
  updated_at: toRequiredNumber(row.updated_at),
  finished_at: toOptionalNumber(row.finished_at)
})

const toWorkspaceIndexJobWriteRow = (job: WorkspaceIndexJobRecord): WorkspaceIndexJobWriteRow => ({
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
  target_ids_json: stringifyTargetIds(job.target_ids),
  message: job.message,
  last_error: job.last_error,
  started_at: job.started_at,
  updated_at: job.updated_at,
  finished_at: job.finished_at
})

export class WorkspaceIndexJobStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveJob(job: WorkspaceIndexJobRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_INDEX_JOB)
    await table.delete(`id = '${this.core.escapeSqlString(job.id)}'`)
    await table.add([toWorkspaceIndexJobWriteRow(job)])
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
    const nextValues = omitUndefined({
      status: values.status,
      phase: values.phase,
      step_index: values.step_index,
      step_total: values.step_total,
      total_count: values.total_count,
      processed_count: values.processed_count,
      failed_count: values.failed_count,
      target_ids_json: values.target_ids ? stringifyTargetIds(values.target_ids) : undefined,
      message: values.message,
      last_error: values.last_error,
      updated_at: values.updated_at,
      finished_at: values.finished_at
    })
    if (Object.keys(nextValues).length === 0) return
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_INDEX_JOB)
    await table.update({
      where: `id = '${this.core.escapeSqlString(id)}'`,
      values: nextValues
    })
  }

  public async getJobById(id: string): Promise<WorkspaceIndexJobRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_INDEX_JOB)
    const rows = (await table
      .query()
      .where(`id = '${this.core.escapeSqlString(id)}'`)
      .limit(1)
      .toArray()) as WorkspaceIndexJobRow[]
    const row = rows[0]
    return row ? toWorkspaceIndexJobRecord(row) : null
  }

  public async getActiveJob(
    workspaceId: string,
    sourceKind: WorkspaceIndexJobSourceKind
  ): Promise<WorkspaceIndexJobRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_INDEX_JOB)
    const where = this.core.combineWhere([
      `workspace_id = '${this.core.escapeSqlString(workspaceId)}'`,
      `source_kind = '${this.core.escapeSqlString(sourceKind)}'`,
      "status = 'running'"
    ])
    const rows = (await table
      .query()
      .where(where || '')
      .toArray()) as WorkspaceIndexJobRow[]
    const jobs = rows.map(toWorkspaceIndexJobRecord).sort((a, b) => b.started_at - a.started_at)
    return jobs[0] || null
  }

  public async listRunningJobs(): Promise<WorkspaceIndexJobRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.WORKSPACE_INDEX_JOB)
    const rows = (await table
      .query()
      .where("status = 'running'")
      .toArray()) as WorkspaceIndexJobRow[]
    return rows.map(toWorkspaceIndexJobRecord).sort((a, b) => a.started_at - b.started_at)
  }

  public async failRunningJobs(message: string, now = Date.now()): Promise<number> {
    const runningJobs = await this.listRunningJobs()
    for (const job of runningJobs) {
      await this.updateJob(job.id, {
        status: 'failed',
        message,
        last_error: message,
        updated_at: now,
        finished_at: now
      })
    }
    return runningJobs.length
  }
}

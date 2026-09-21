import type { ChatMessageContentNode, ScheduledTask, ScheduledTaskScheduleType, SelectedReference } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { fromSqliteBoolean, parseJsonArray, toOptionalNumber } from '../sqlite/sqliteUtils'

type ScheduledTaskRow = {
  id?: unknown
  name?: unknown
  description?: unknown
  content_nodes_json?: unknown
  selected_references_json?: unknown
  enabled?: unknown
  schedule_type?: unknown
  time_of_day?: unknown
  weekday?: unknown
  partner_id?: unknown
  next_run_at?: unknown
  busy_cancel_notice_at?: unknown
  created_at?: unknown
  updated_at?: unknown
}

const toScheduleType = (value: unknown): ScheduledTaskScheduleType =>
  value === 'weekly' ? 'weekly' : 'daily'

const toTask = (row: ScheduledTaskRow): ScheduledTask => {
  const weekday = toOptionalNumber(row.weekday)
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    contentNodes: parseJsonArray<ChatMessageContentNode>(row.content_nodes_json) || [],
    selectedReferences: parseJsonArray<SelectedReference>(row.selected_references_json) || [],
    enabled: fromSqliteBoolean(row.enabled),
    scheduleType: toScheduleType(row.schedule_type),
    timeOfDay: String(row.time_of_day || ''),
    weekday: weekday ?? null,
    partnerId: String(row.partner_id || ''),
    nextRunAt: toOptionalNumber(row.next_run_at) ?? null,
    busyCancelNoticeAt: toOptionalNumber(row.busy_cancel_notice_at) ?? null,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  }
}

export class ScheduledTaskStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async list(): Promise<ScheduledTask[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM scheduled_task ORDER BY created_at ASC')
      .all() as ScheduledTaskRow[]
    return rows.map(toTask)
  }

  public async listEnabled(): Promise<ScheduledTask[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM scheduled_task WHERE enabled = 1 ORDER BY created_at ASC')
      .all() as ScheduledTaskRow[]
    return rows.map(toTask)
  }

  public async listByPartner(partnerId: string): Promise<ScheduledTask[]> {
    const id = String(partnerId || '').trim()
    if (!id) return []
    const rows = this.sqlite
      .prepare('SELECT * FROM scheduled_task WHERE partner_id = ? ORDER BY created_at ASC')
      .all(id) as ScheduledTaskRow[]
    return rows.map(toTask)
  }

  public async getById(id: string): Promise<ScheduledTask | null> {
    const safeId = String(id || '').trim()
    if (!safeId) return null
    const row = this.sqlite.prepare('SELECT * FROM scheduled_task WHERE id = ?').get(safeId) as
      | ScheduledTaskRow
      | undefined
    return row ? toTask(row) : null
  }

  public async save(task: ScheduledTask): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO scheduled_task (
          id, name, description, content_nodes_json, selected_references_json, enabled,
          schedule_type, time_of_day, weekday, partner_id, next_run_at, busy_cancel_notice_at,
          created_at, updated_at
        ) VALUES (
          @id, @name, @description, @content_nodes_json, @selected_references_json, @enabled,
          @schedule_type, @time_of_day, @weekday, @partner_id, @next_run_at,
          @busy_cancel_notice_at, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          content_nodes_json = excluded.content_nodes_json,
          selected_references_json = excluded.selected_references_json,
          enabled = excluded.enabled,
          schedule_type = excluded.schedule_type,
          time_of_day = excluded.time_of_day,
          weekday = excluded.weekday,
          partner_id = excluded.partner_id,
          next_run_at = excluded.next_run_at,
          busy_cancel_notice_at = excluded.busy_cancel_notice_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: task.id,
        name: task.name,
        description: task.description,
        content_nodes_json: JSON.stringify(task.contentNodes),
        selected_references_json: JSON.stringify(task.selectedReferences),
        enabled: task.enabled ? 1 : 0,
        schedule_type: task.scheduleType,
        time_of_day: task.timeOfDay,
        weekday: task.weekday,
        partner_id: task.partnerId,
        next_run_at: task.nextRunAt,
        busy_cancel_notice_at: task.busyCancelNoticeAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt
      })
  }

  public async delete(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM scheduled_task WHERE id = ?').run(id)
  }

  public async clearPartner(partnerId: string, updatedAt: number): Promise<void> {
    this.sqlite
      .prepare(
        `UPDATE scheduled_task
         SET partner_id = '', enabled = 0, next_run_at = NULL, busy_cancel_notice_at = NULL, updated_at = ?
         WHERE partner_id = ?`
      )
      .run(updatedAt, partnerId)
  }
}

import type {
  AiExecutionPermission,
  AiPreference,
  ScheduledTask,
  ScheduledTaskScheduleType,
  WorkbenchSelectedModel
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { fromSqliteBoolean, toOptionalNumber } from '../sqlite/sqliteUtils'

type ScheduledTaskRow = {
  id?: unknown
  name?: unknown
  prompt?: unknown
  enabled?: unknown
  schedule_type?: unknown
  time_of_day?: unknown
  weekday?: unknown
  workspace_id?: unknown
  main_model_config_id?: unknown
  main_model_name?: unknown
  ai_preference?: unknown
  execution_permission?: unknown
  next_run_at?: unknown
  created_at?: unknown
  updated_at?: unknown
}

const toScheduleType = (value: unknown): ScheduledTaskScheduleType =>
  value === 'weekly' ? 'weekly' : 'daily'

const toPreference = (value: unknown): AiPreference =>
  value === 'local_sources_relaxed' || value === 'local_sources_strict' ? value : 'default'

const toPermission = (value: unknown): AiExecutionPermission =>
  value === 'full_access' ? 'full_access' : 'review'

const toModel = (configId: unknown, modelName: unknown): WorkbenchSelectedModel | null => {
  const id = String(configId || '').trim()
  const name = String(modelName || '').trim()
  if (!id || !name) return null
  return { configId: id, modelName: name }
}

const toTask = (row: ScheduledTaskRow): ScheduledTask => {
  const mainModel = toModel(row.main_model_config_id, row.main_model_name)
  const weekday = toOptionalNumber(row.weekday)
  if (!mainModel) {
    throw new Error(`scheduled_task_missing_main_model:${String(row.id || '')}`)
  }
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    prompt: String(row.prompt || ''),
    enabled: fromSqliteBoolean(row.enabled),
    scheduleType: toScheduleType(row.schedule_type),
    timeOfDay: String(row.time_of_day || ''),
    weekday: weekday ?? null,
    workspaceId: String(row.workspace_id || ''),
    mainModel,
    aiPreference: toPreference(row.ai_preference),
    executionPermission: toPermission(row.execution_permission),
    nextRunAt: toOptionalNumber(row.next_run_at) ?? null,
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
          id, name, prompt, enabled, schedule_type, time_of_day, weekday,
          workspace_id, main_model_config_id, main_model_name,
          ai_preference,
          execution_permission, next_run_at, created_at, updated_at
        ) VALUES (
          @id, @name, @prompt, @enabled, @schedule_type, @time_of_day, @weekday,
          @workspace_id, @main_model_config_id, @main_model_name,
          @ai_preference,
          @execution_permission, @next_run_at, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          prompt = excluded.prompt,
          enabled = excluded.enabled,
          schedule_type = excluded.schedule_type,
          time_of_day = excluded.time_of_day,
          weekday = excluded.weekday,
          workspace_id = excluded.workspace_id,
          main_model_config_id = excluded.main_model_config_id,
          main_model_name = excluded.main_model_name,
          ai_preference = excluded.ai_preference,
          execution_permission = excluded.execution_permission,
          next_run_at = excluded.next_run_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: task.id,
        name: task.name,
        prompt: task.prompt,
        enabled: task.enabled ? 1 : 0,
        schedule_type: task.scheduleType,
        time_of_day: task.timeOfDay,
        weekday: task.weekday,
        workspace_id: task.workspaceId,
        main_model_config_id: task.mainModel.configId,
        main_model_name: task.mainModel.modelName,
        ai_preference: task.aiPreference,
        execution_permission: task.executionPermission,
        next_run_at: task.nextRunAt,
        created_at: task.createdAt,
        updated_at: task.updatedAt
      })
  }

  public async delete(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM scheduled_task WHERE id = ?').run(id)
  }
}

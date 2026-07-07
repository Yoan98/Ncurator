import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiRunEvent,
  AiRunEventRecord,
  AiRunRecord,
  AiRunStatus,
  ChatAttachment,
  SelectedReference,
  WorkspaceRuntimeBinding
} from '../../../../shared/types'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type AiRunRow = {
  id?: unknown
  session_id?: unknown
  user_message_id?: unknown
  assistant_message_id?: unknown
  status?: unknown
  input?: unknown
  selected_references_json?: unknown
  attachments_json?: unknown
  workspace_json?: unknown
  model_name?: unknown
  partial_answer?: unknown
  final_answer?: unknown
  error?: unknown
  pending_approval_json?: unknown
  artifacts_json?: unknown
  process_events_json?: unknown
  event_count?: unknown
  visible_event_count?: unknown
  last_event_at?: unknown
  created_at?: unknown
  updated_at?: unknown
  finished_at?: unknown
}

type AiRunEventRow = {
  id?: unknown
  run_id?: unknown
  session_id?: unknown
  seq?: unknown
  type?: unknown
  event_json?: unknown
  created_at?: unknown
}

const parseJsonArray = <T>(value: unknown): T[] | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? (parsed as T[]) : undefined
  } catch {
    return undefined
  }
}

const parseJsonObject = <T>(value: unknown): T | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

const normalizeRunStatus = (value: unknown): AiRunStatus => {
  const status = String(value || '')
  if (
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status
  }
  return 'failed'
}

const RUN_COLUMNS = [
  'id',
  'session_id',
  'user_message_id',
  'assistant_message_id',
  'status',
  'input',
  'selected_references_json',
  'attachments_json',
  'workspace_json',
  'model_name',
  'partial_answer',
  'final_answer',
  'error',
  'pending_approval_json',
  'artifacts_json',
  'process_events_json',
  'event_count',
  'visible_event_count',
  'last_event_at',
  'created_at',
  'updated_at',
  'finished_at'
]

const EVENT_COLUMNS = ['id', 'run_id', 'session_id', 'seq', 'type', 'event_json', 'created_at']

const shouldPersistEvent = (event: AiRunEvent): boolean =>
  event.type !== 'answer_token' && event.type !== 'llm_stream_delta'

const getEventTime = (event: AiRunEvent, fallback: number): number => {
  const record = event as unknown as Record<string, unknown>
  for (const key of ['createdAt', 'completedAt', 'failedAt', 'decidedAt']) {
    const value = Number(record[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

const toRunRecord = (row: AiRunRow): AiRunRecord => ({
  id: String(row.id || ''),
  sessionId: String(row.session_id || ''),
  userMessageId: String(row.user_message_id || ''),
  assistantMessageId: String(row.assistant_message_id || ''),
  status: normalizeRunStatus(row.status),
  input: String(row.input || ''),
  selectedReferences: parseJsonArray<SelectedReference>(row.selected_references_json),
  attachments: parseJsonArray<ChatAttachment>(row.attachments_json),
  workspace: parseJsonObject<WorkspaceRuntimeBinding>(row.workspace_json),
  modelName: row.model_name ? String(row.model_name) : undefined,
  partialAnswer: String(row.partial_answer || ''),
  finalAnswer: row.final_answer ? String(row.final_answer) : undefined,
  error: row.error ? String(row.error) : undefined,
  pendingApproval: parseJsonObject<AiRunRecord['pendingApproval']>(row.pending_approval_json),
  artifacts: parseJsonArray<AiArtifactRef>(row.artifacts_json),
  processEvents: parseJsonArray<AiRunEvent>(row.process_events_json),
  eventCount: row.event_count ? Number(row.event_count) : undefined,
  visibleEventCount: row.visible_event_count ? Number(row.visible_event_count) : undefined,
  lastEventAt: row.last_event_at ? Number(row.last_event_at) : undefined,
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  finishedAt: row.finished_at ? Number(row.finished_at) : undefined
})

const toEventRecord = (row: AiRunEventRow): AiRunEventRecord | null => {
  const event = parseJsonObject<AiRunEvent>(row.event_json)
  if (!event) return null
  return {
    id: String(row.id || ''),
    runId: String(row.run_id || ''),
    sessionId: String(row.session_id || ''),
    seq: Number(row.seq || 0),
    type: event.type,
    event,
    createdAt: Number(row.created_at || 0)
  }
}

export class AiRunStore {
  private readonly lastEventSeqByRun = new Map<string, number>()
  private readonly eventSeqQueues = new Map<string, Promise<unknown>>()

  public constructor(private readonly core: LanceDbCore) {}

  public async saveRun(record: AiRunRecord): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUN)
    await table
      .mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([
        {
          id: record.id,
          session_id: record.sessionId,
          user_message_id: record.userMessageId,
          assistant_message_id: record.assistantMessageId,
          status: record.status,
          input: record.input,
          selected_references_json: record.selectedReferences
            ? JSON.stringify(record.selectedReferences)
            : undefined,
          attachments_json: record.attachments ? JSON.stringify(record.attachments) : undefined,
          workspace_json: record.workspace ? JSON.stringify(record.workspace) : undefined,
          model_name: record.modelName,
          partial_answer: record.partialAnswer,
          final_answer: record.finalAnswer,
          error: record.error,
          pending_approval_json: record.pendingApproval
            ? JSON.stringify(record.pendingApproval)
            : undefined,
          artifacts_json: record.artifacts ? JSON.stringify(record.artifacts) : undefined,
          process_events_json: record.processEvents
            ? JSON.stringify(record.processEvents)
            : undefined,
          event_count: record.eventCount,
          visible_event_count: record.visibleEventCount,
          last_event_at: record.lastEventAt,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          finished_at: record.finishedAt
        }
      ])
  }

  public async getRun(runId: string): Promise<AiRunRecord | null> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUN)
    const rows = await table
      .query()
      .where(`id = '${this.core.escapeSqlString(runId)}'`)
      .select(RUN_COLUMNS)
      .limit(1)
      .toArray()
    const row = rows[0] as AiRunRow | undefined
    return row ? toRunRecord(row) : null
  }

  public async listRunsBySession(
    sessionId: string,
    statuses?: AiRunStatus[]
  ): Promise<AiRunRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUN)
    const sessionWhere = `session_id = '${this.core.escapeSqlString(sessionId)}'`
    const statusWhere = this.core.buildInClause('status', statuses)
    const where = this.core.combineWhere([sessionWhere, statusWhere])
    const query = where ? table.query().where(where) : table.query()
    const rows = await query.select(RUN_COLUMNS).toArray()
    return rows.map((row) => toRunRecord(row as AiRunRow)).sort((a, b) => a.createdAt - b.createdAt)
  }

  public async listRunsByStatuses(statuses: AiRunStatus[]): Promise<AiRunRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUN)
    const where = this.core.buildInClause('status', statuses)
    const query = where ? table.query().where(where) : table.query()
    const rows = await query.select(RUN_COLUMNS).toArray()
    return rows.map((row) => toRunRecord(row as AiRunRow)).sort((a, b) => a.createdAt - b.createdAt)
  }

  public async appendEvent(input: {
    runId: string
    sessionId: string
    event: AiRunEvent
  }): Promise<AiRunEventRecord> {
    const records = await this.appendEvents({
      runId: input.runId,
      sessionId: input.sessionId,
      events: [input.event]
    })
    return records[0]
  }

  public async appendEvents(input: {
    runId: string
    sessionId: string
    events: AiRunEvent[]
  }): Promise<AiRunEventRecord[]> {
    return await this.withRunEventSeqQueue(input.runId, async () => {
      const now = Date.now()
      const records = input.events.map((event) => ({
        id: uuidv4(),
        runId: input.runId,
        sessionId: input.sessionId,
        seq: 0,
        type: event.type,
        event,
        createdAt: getEventTime(event, now)
      }))
      const persistedRecords = records.filter((record) => shouldPersistEvent(record.event))
      if (persistedRecords.length === 0) {
        return records
      }

      const startSeq = await this.allocateNextEventSeqRange(input.runId, persistedRecords.length)
      persistedRecords.forEach((record, index) => {
        record.seq = startSeq + index
      })

      const table = await this.core.openTable(LANCE_TABLES.AI_RUN_EVENT)
      await table.add(
        persistedRecords.map((record) => ({
          id: record.id,
          run_id: record.runId,
          session_id: record.sessionId,
          seq: record.seq,
          type: record.type,
          event_json: JSON.stringify(record.event),
          created_at: record.createdAt
        }))
      )
      return records
    })
  }

  public async listEvents(runId: string): Promise<AiRunEventRecord[]> {
    const table = await this.core.openTable(LANCE_TABLES.AI_RUN_EVENT)
    const rows = await table
      .query()
      .where(`run_id = '${this.core.escapeSqlString(runId)}'`)
      .select(EVENT_COLUMNS)
      .toArray()
    return rows
      .map((row) => toEventRecord(row as AiRunEventRow))
      .filter((record): record is AiRunEventRecord => record !== null)
      .sort((a, b) => a.seq - b.seq)
  }

  public async deleteRunsBySession(sessionId: string): Promise<void> {
    const safeSessionId = this.core.escapeSqlString(sessionId)
    const runs = await this.listRunsBySession(sessionId)
    for (const run of runs) {
      this.lastEventSeqByRun.delete(run.id)
      this.eventSeqQueues.delete(run.id)
    }
    const eventTable = await this.core.openTable(LANCE_TABLES.AI_RUN_EVENT)
    await eventTable.delete(`session_id = '${safeSessionId}'`)
    const runTable = await this.core.openTable(LANCE_TABLES.AI_RUN)
    await runTable.delete(`session_id = '${safeSessionId}'`)
  }

  public async deleteRunsByIds(runIds: string[]): Promise<void> {
    const safeIds = runIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (safeIds.length === 0) return
    for (const runId of safeIds) {
      this.lastEventSeqByRun.delete(runId)
      this.eventSeqQueues.delete(runId)
    }
    const where = this.core.buildInClause('run_id', safeIds)
    if (where) {
      const eventTable = await this.core.openTable(LANCE_TABLES.AI_RUN_EVENT)
      await eventTable.delete(where)
    }
    const runWhere = this.core.buildInClause('id', safeIds)
    if (runWhere) {
      const runTable = await this.core.openTable(LANCE_TABLES.AI_RUN)
      await runTable.delete(runWhere)
    }
  }

  private async allocateNextEventSeqRange(runId: string, count: number): Promise<number> {
    const lastSeq = this.lastEventSeqByRun.get(runId)
    if (lastSeq !== undefined) {
      const nextSeq = lastSeq + 1
      this.lastEventSeqByRun.set(runId, nextSeq + count - 1)
      return nextSeq
    }

    const existing = await this.listEvents(runId)
    const nextSeq = existing.reduce((max, event) => Math.max(max, event.seq), 0) + 1
    this.lastEventSeqByRun.set(runId, nextSeq + count - 1)
    return nextSeq
  }

  private async withRunEventSeqQueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.eventSeqQueues.get(runId) || Promise.resolve()
    const queued = previous.catch(() => undefined).then(operation)
    const tail = queued.catch(() => undefined)
    this.eventSeqQueues.set(runId, tail)
    void tail.finally(() => {
      if (this.eventSeqQueues.get(runId) === tail) {
        this.eventSeqQueues.delete(runId)
      }
    })
    return await queued
  }
}

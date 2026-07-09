import { v4 as uuidv4 } from 'uuid'
import type {
  AiArtifactRef,
  AiRunApprovalBatchDecisionRequest,
  AiRunEvent,
  AiRunEventRecord,
  AiRunRecord,
  AiRunStatus,
  ChatAttachment,
  SelectedReference,
  WorkspaceRuntimeBinding
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  buildInClause,
  buildWhere,
  jsonStringify,
  parseJsonArray,
  parseJsonObject,
  toOptionalNumber,
  toRequiredNumber,
  toRequiredString
} from '../sqlite/sqliteUtils'

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
  id: toRequiredString(row.id),
  sessionId: toRequiredString(row.session_id),
  userMessageId: toRequiredString(row.user_message_id),
  assistantMessageId: toRequiredString(row.assistant_message_id),
  status: normalizeRunStatus(row.status),
  input: toRequiredString(row.input),
  selectedReferences: parseJsonArray<SelectedReference>(row.selected_references_json),
  attachments: parseJsonArray<ChatAttachment>(row.attachments_json),
  workspace: parseJsonObject<WorkspaceRuntimeBinding>(row.workspace_json),
  modelName: row.model_name ? String(row.model_name) : undefined,
  partialAnswer: toRequiredString(row.partial_answer),
  finalAnswer: row.final_answer ? String(row.final_answer) : undefined,
  error: row.error ? String(row.error) : undefined,
  pendingApproval: parseJsonObject<AiRunRecord['pendingApproval']>(row.pending_approval_json),
  artifacts: parseJsonArray<AiArtifactRef>(row.artifacts_json),
  processEvents: undefined,
  eventCount: toOptionalNumber(row.event_count),
  visibleEventCount: toOptionalNumber(row.visible_event_count),
  lastEventAt: toOptionalNumber(row.last_event_at),
  createdAt: toRequiredNumber(row.created_at),
  updatedAt: toRequiredNumber(row.updated_at),
  finishedAt: toOptionalNumber(row.finished_at)
})

const toEventRecord = (row: AiRunEventRow): AiRunEventRecord | null => {
  const event = parseJsonObject<AiRunEvent>(row.event_json)
  if (!event) return null
  return {
    id: toRequiredString(row.id),
    runId: toRequiredString(row.run_id),
    sessionId: toRequiredString(row.session_id),
    seq: toRequiredNumber(row.seq),
    type: event.type,
    event,
    createdAt: toRequiredNumber(row.created_at)
  }
}

export class AiRunStore {
  private readonly eventSeqQueues = new Map<string, Promise<unknown>>()

  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveRun(record: AiRunRecord): Promise<void> {
    this.sqlite
      .prepare(
        `
        INSERT INTO ai_run (
          id, session_id, user_message_id, assistant_message_id, status, input,
          selected_references_json, attachments_json, workspace_json, model_name,
          partial_answer, final_answer, error, pending_approval_json, artifacts_json,
          event_count, visible_event_count, last_event_at, created_at, updated_at, finished_at
        ) VALUES (
          @id, @session_id, @user_message_id, @assistant_message_id, @status, @input,
          @selected_references_json, @attachments_json, @workspace_json, @model_name,
          @partial_answer, @final_answer, @error, @pending_approval_json, @artifacts_json,
          @event_count, @visible_event_count, @last_event_at, @created_at, @updated_at, @finished_at
        )
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          user_message_id = excluded.user_message_id,
          assistant_message_id = excluded.assistant_message_id,
          status = excluded.status,
          input = excluded.input,
          selected_references_json = excluded.selected_references_json,
          attachments_json = excluded.attachments_json,
          workspace_json = excluded.workspace_json,
          model_name = excluded.model_name,
          partial_answer = excluded.partial_answer,
          final_answer = excluded.final_answer,
          error = excluded.error,
          pending_approval_json = excluded.pending_approval_json,
          artifacts_json = excluded.artifacts_json,
          event_count = excluded.event_count,
          visible_event_count = excluded.visible_event_count,
          last_event_at = excluded.last_event_at,
          updated_at = excluded.updated_at,
          finished_at = excluded.finished_at
      `
      )
      .run({
        id: record.id,
        session_id: record.sessionId,
        user_message_id: record.userMessageId,
        assistant_message_id: record.assistantMessageId,
        status: record.status,
        input: record.input,
        selected_references_json: jsonStringify(record.selectedReferences),
        attachments_json: jsonStringify(record.attachments),
        workspace_json: jsonStringify(record.workspace),
        model_name: record.modelName || null,
        partial_answer: record.partialAnswer || '',
        final_answer: record.finalAnswer || null,
        error: record.error || null,
        pending_approval_json: jsonStringify(record.pendingApproval),
        artifacts_json: jsonStringify(record.artifacts),
        event_count: record.eventCount ?? null,
        visible_event_count: record.visibleEventCount ?? null,
        last_event_at: record.lastEventAt ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        finished_at: record.finishedAt ?? null
      })
  }

  public async getRun(runId: string): Promise<AiRunRecord | null> {
    const row = this.sqlite.prepare('SELECT * FROM ai_run WHERE id = ?').get(runId) as
      | AiRunRow
      | undefined
    return row ? toRunRecord(row) : null
  }

  public async listRunsBySession(
    sessionId: string,
    statuses?: AiRunStatus[]
  ): Promise<AiRunRecord[]> {
    const params: Record<string, string | number | null> = { session_id: sessionId }
    const where = buildWhere([
      'session_id = @session_id',
      buildInClause('status', statuses, params, 'status')
    ])
    const rows = this.sqlite
      .prepare(`SELECT * FROM ai_run WHERE ${where} ORDER BY created_at ASC`)
      .all(params) as AiRunRow[]
    return rows.map(toRunRecord)
  }

  public async listRunsByMessageIds(
    sessionId: string,
    messageIds: string[]
  ): Promise<AiRunRecord[]> {
    const ids = messageIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (ids.length === 0) return []
    const params: Record<string, string | number | null> = { session_id: sessionId }
    const where = buildWhere([
      'session_id = @session_id',
      buildInClause('assistant_message_id', ids, params, 'message_id')
    ])
    const rows = this.sqlite
      .prepare(`SELECT * FROM ai_run WHERE ${where} ORDER BY created_at ASC`)
      .all(params) as AiRunRow[]
    return rows.map(toRunRecord)
  }

  public async listRunsByStatuses(statuses: AiRunStatus[]): Promise<AiRunRecord[]> {
    const params: Record<string, string | number | null> = {}
    const where = buildWhere([buildInClause('status', statuses, params, 'status')])
    const rows = this.sqlite
      .prepare(`SELECT * FROM ai_run WHERE ${where} ORDER BY created_at ASC`)
      .all(params) as AiRunRow[]
    return rows.map(toRunRecord)
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
      const allRecords = input.events.map((event) => ({
        id: uuidv4(),
        runId: input.runId,
        sessionId: input.sessionId,
        seq: 0,
        type: event.type,
        event,
        createdAt: getEventTime(event, now)
      }))
      const persisted = allRecords.filter((record) => shouldPersistEvent(record.event))
      if (persisted.length === 0) return allRecords

      this.sqlite.transaction(() => {
        const nextSeqRow = this.sqlite
          .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM ai_run_event WHERE run_id = ?')
          .get(input.runId) as { next_seq?: unknown }
        const startSeq = toRequiredNumber(nextSeqRow.next_seq, 1)
        const insert = this.sqlite.prepare(
          `
          INSERT INTO ai_run_event (id, run_id, session_id, seq, type, event_json, created_at)
          VALUES (@id, @run_id, @session_id, @seq, @type, @event_json, @created_at)
        `
        )
        persisted.forEach((record, index) => {
          record.seq = startSeq + index
          insert.run({
            id: record.id,
            run_id: record.runId,
            session_id: record.sessionId,
            seq: record.seq,
            type: record.type,
            event_json: JSON.stringify(record.event),
            created_at: record.createdAt
          })
        })
      })
      return allRecords
    })
  }

  public async decideApprovalBatchTransaction(input: {
    runId: string
    request: AiRunApprovalBatchDecisionRequest
    event: AiRunEvent
  }): Promise<{ ok: boolean; run?: AiRunRecord; error?: string }> {
    return this.sqlite.transaction(() => {
      const runRow = this.sqlite
        .prepare('SELECT * FROM ai_run WHERE id = ?')
        .get(input.runId) as AiRunRow | undefined
      if (!runRow) return { ok: false, error: 'run not found' }
      const run = toRunRecord(runRow)
      if (run.status !== 'waiting_approval' || !run.pendingApproval) {
        return { ok: false, error: 'approval batch not found' }
      }
      if (run.pendingApproval.batchId !== input.request.batchId) {
        return { ok: false, error: 'approval batch not found' }
      }

      const now = getEventTime(input.event, Date.now())
      const nextSeqRow = this.sqlite
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM ai_run_event WHERE run_id = ?')
        .get(input.runId) as { next_seq?: unknown }
      this.sqlite
        .prepare(
          `
          INSERT INTO ai_run_event (id, run_id, session_id, seq, type, event_json, created_at)
          VALUES (@id, @run_id, @session_id, @seq, @type, @event_json, @created_at)
        `
        )
        .run({
          id: uuidv4(),
          run_id: run.id,
          session_id: run.sessionId,
          seq: toRequiredNumber(nextSeqRow.next_seq, 1),
          type: input.event.type,
          event_json: JSON.stringify(input.event),
          created_at: now
        })
      this.sqlite
        .prepare(
          `
          UPDATE ai_run
          SET status = 'running',
              pending_approval_json = NULL,
              event_count = COALESCE(event_count, 0) + 1,
              visible_event_count = COALESCE(visible_event_count, 0) + 1,
              last_event_at = @last_event_at,
              updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({ id: run.id, last_event_at: now, updated_at: now })

      return {
        ok: true,
        run: {
          ...run,
          status: 'running',
          pendingApproval: undefined,
          eventCount: (run.eventCount || 0) + 1,
          visibleEventCount: (run.visibleEventCount || 0) + 1,
          lastEventAt: now,
          updatedAt: now
        }
      }
    })
  }

  public async listEvents(runId: string): Promise<AiRunEventRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM ai_run_event WHERE run_id = ? ORDER BY seq ASC')
      .all(runId) as AiRunEventRow[]
    return rows
      .map(toEventRecord)
      .filter((record): record is AiRunEventRecord => record !== null)
  }

  public async deleteRunsBySession(sessionId: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM ai_run WHERE session_id = ?').run(sessionId)
    for (const runId of Array.from(this.eventSeqQueues.keys())) {
      this.eventSeqQueues.delete(runId)
    }
  }

  public async deleteRunsByIds(runIds: string[]): Promise<void> {
    const ids = runIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (ids.length === 0) return
    this.sqlite.transaction(() => {
      const stmt = this.sqlite.prepare('DELETE FROM ai_run WHERE id = ?')
      for (const id of ids) {
        this.eventSeqQueues.delete(id)
        stmt.run(id)
      }
    })
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

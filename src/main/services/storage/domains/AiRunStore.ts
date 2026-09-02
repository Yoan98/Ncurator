import type {
  AiArtifactRef,
  AiRunApprovalBatchDecisionRequest,
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
  main_model_json?: unknown
  execution_permission?: string | null
  partial_answer?: unknown
  partial_answer_role?: unknown
  final_answer?: unknown
  error?: unknown
  failure_code?: unknown
  pending_approval_json?: unknown
  artifacts_json?: unknown
  created_at?: unknown
  updated_at?: unknown
  finished_at?: unknown
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

const normalizeExecutionPermission = (value: string): AiRunRecord['executionPermission'] =>
  value === 'full_access' ? 'full_access' : 'review'

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
  mainModel: parseJsonObject<AiRunRecord['mainModel']>(row.main_model_json),
  executionPermission: normalizeExecutionPermission(row.execution_permission || ''),
  partialAnswer: toRequiredString(row.partial_answer),
  partialAnswerRole: row.partial_answer_role === 'thought' ? 'thought' : 'answer',
  finalAnswer: row.final_answer ? String(row.final_answer) : undefined,
  error: row.error ? String(row.error) : undefined,
  failureCode: row.failure_code
    ? (String(row.failure_code) as AiRunRecord['failureCode'])
    : undefined,
  pendingApproval: parseJsonObject<AiRunRecord['pendingApproval']>(row.pending_approval_json),
  artifacts: parseJsonArray<AiArtifactRef>(row.artifacts_json),
  createdAt: toRequiredNumber(row.created_at),
  updatedAt: toRequiredNumber(row.updated_at),
  finishedAt: toOptionalNumber(row.finished_at)
})

export class AiRunStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveRun(record: AiRunRecord): Promise<void> {
    this.sqlite
      .prepare(
        `
        INSERT INTO ai_run (
          id, session_id, user_message_id, assistant_message_id, status, input,
          selected_references_json, attachments_json, workspace_json, model_name,
          main_model_json, execution_permission,
          partial_answer, partial_answer_role, final_answer, error, failure_code, pending_approval_json,
          artifacts_json, created_at, updated_at, finished_at
        ) VALUES (
          @id, @session_id, @user_message_id, @assistant_message_id, @status, @input,
          @selected_references_json, @attachments_json, @workspace_json, @model_name,
          @main_model_json, @execution_permission,
          @partial_answer, @partial_answer_role, @final_answer, @error, @failure_code, @pending_approval_json,
          @artifacts_json, @created_at, @updated_at, @finished_at
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
          main_model_json = excluded.main_model_json,
          execution_permission = excluded.execution_permission,
          partial_answer = excluded.partial_answer,
          partial_answer_role = excluded.partial_answer_role,
          final_answer = excluded.final_answer,
          error = excluded.error,
          failure_code = excluded.failure_code,
          pending_approval_json = excluded.pending_approval_json,
          artifacts_json = excluded.artifacts_json,
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
        main_model_json: jsonStringify(record.mainModel),
        execution_permission: record.executionPermission || 'review',
        partial_answer: record.partialAnswer || '',
        partial_answer_role: record.partialAnswerRole || 'answer',
        final_answer: record.finalAnswer || null,
        error: record.error || null,
        failure_code: record.failureCode || null,
        pending_approval_json: jsonStringify(record.pendingApproval),
        artifacts_json: jsonStringify(record.artifacts),
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

  public async listSessionIdsByRunStatuses(statuses: AiRunStatus[]): Promise<string[]> {
    const params: Record<string, string | number | null> = {}
    const where = buildWhere([buildInClause('status', statuses, params, 'status')])
    const rows = this.sqlite
      .prepare(`SELECT DISTINCT session_id FROM ai_run WHERE ${where}`)
      .all(params) as Array<{ session_id?: unknown }>
    return rows.map((row) => toRequiredString(row.session_id)).filter(Boolean)
  }

  public async decideApprovalBatchTransaction(input: {
    runId: string
    request: AiRunApprovalBatchDecisionRequest
  }): Promise<{ ok: boolean; run?: AiRunRecord; error?: string }> {
    return this.sqlite.transaction(() => {
      const runRow = this.sqlite.prepare('SELECT * FROM ai_run WHERE id = ?').get(input.runId) as
        | AiRunRow
        | undefined
      if (!runRow) return { ok: false, error: 'run not found' }
      const run = toRunRecord(runRow)
      if (run.status !== 'waiting_approval' || !run.pendingApproval) {
        return { ok: false, error: 'approval batch not found' }
      }
      if (run.pendingApproval.batchId !== input.request.batchId) {
        return { ok: false, error: 'approval batch not found' }
      }

      const now = Date.now()
      this.sqlite
        .prepare(
          `
          UPDATE ai_run
          SET status = 'running',
              pending_approval_json = NULL,
              updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({ id: run.id, updated_at: now })

      return {
        ok: true,
        run: {
          ...run,
          status: 'running',
          pendingApproval: undefined,
          updatedAt: now
        }
      }
    })
  }

  public async deleteRunsBySession(sessionId: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM ai_run WHERE session_id = ?').run(sessionId)
  }

  public async deleteRunsByIds(runIds: string[]): Promise<void> {
    const ids = runIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (ids.length === 0) return
    this.sqlite.transaction(() => {
      const stmt = this.sqlite.prepare('DELETE FROM ai_run WHERE id = ?')
      for (const id of ids) {
        stmt.run(id)
      }
    })
  }
}

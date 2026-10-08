import { v4 as uuidv4 } from 'uuid'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  jsonStringify,
  parseJsonObject,
  toRequiredNumber,
  toRequiredString
} from '../sqlite/sqliteUtils'

type ChatMessageLogRow = {
  id?: unknown
  partner_id?: unknown
  run_id?: unknown
  seq?: unknown
  entry_json?: unknown
  created_at?: unknown
}

const toMessageLogRecord = (row: ChatMessageLogRow): ChatMessageLogRecord | null => {
  const entry = parseJsonObject<ChatMessageLogEntry>(row.entry_json)
  if (!entry) return null
  return {
    id: toRequiredString(row.id),
    partnerId: toRequiredString(row.partner_id),
    runId: toRequiredString(row.run_id),
    seq: toRequiredNumber(row.seq),
    entry,
    createdAt: toRequiredNumber(row.created_at)
  }
}

export class ChatMessageLogStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async appendBatch(input: {
    partnerId: string
    runId: string
    entries: ChatMessageLogEntry[]
    createdAt?: number
  }): Promise<ChatMessageLogRecord[]> {
    return this.appendBatchSync(input)
  }

  public appendBatchSync(input: {
    partnerId: string
    runId: string
    entries: ChatMessageLogEntry[]
    createdAt?: number
  }): ChatMessageLogRecord[] {
    if (input.entries.length === 0) return []
    return this.sqlite.transaction(() => {
      const nextSeqRow = this.sqlite
        .prepare(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM chat_session_message_log WHERE partner_id = ?'
        )
        .get(input.partnerId) as { next_seq?: unknown }
      const startSeq = toRequiredNumber(nextSeqRow.next_seq, 1)
      const insert = this.sqlite.prepare(
        `
        INSERT INTO chat_session_message_log (id, partner_id, run_id, seq, entry_json, created_at)
        VALUES (@id, @partner_id, @run_id, @seq, @entry_json, @created_at)
      `
      )
      const baseCreatedAt = input.createdAt != null ? input.createdAt : Date.now()
      const records: ChatMessageLogRecord[] = []
      input.entries.forEach((entry, index) => {
        const seq = startSeq + index
        const record: ChatMessageLogRecord = {
          id: uuidv4(),
          partnerId: input.partnerId,
          runId: input.runId,
          seq,
          entry,
          createdAt: baseCreatedAt + index
        }
        insert.run({
          id: record.id,
          partner_id: record.partnerId,
          run_id: record.runId,
          seq: record.seq,
          entry_json: jsonStringify(record.entry),
          created_at: record.createdAt
        })
        records.push(record)
      })
      return records
    })
  }

  public async list(partnerId: string): Promise<ChatMessageLogRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_session_message_log WHERE partner_id = ? ORDER BY seq ASC')
      .all(partnerId) as ChatMessageLogRow[]
    return rows
      .map(toMessageLogRecord)
      .filter((record): record is ChatMessageLogRecord => record !== null)
  }

  public async listPage(input: {
    partnerId: string
    limit: number
    beforeSeq?: number
  }): Promise<{ records: ChatMessageLogRecord[]; hasMoreBefore: boolean }> {
    const safeLimit = Math.max(1, Math.min(500, Number(input.limit || 50)))
    const beforeSeq = Number(input.beforeSeq)
    const params = {
      partner_id: input.partnerId,
      before: Number.isFinite(beforeSeq) ? Math.floor(beforeSeq) : null,
      limit: safeLimit + 1
    }
    const rows = this.sqlite
      .prepare(
        `
        SELECT * FROM chat_session_message_log
        WHERE partner_id = @partner_id
          AND (@before IS NULL OR seq < @before)
        ORDER BY seq DESC
        LIMIT @limit
      `
      )
      .all(params) as ChatMessageLogRow[]
    const hasMoreBefore = rows.length > safeLimit
    const pageRows = rows.slice(0, safeLimit).reverse()
    return {
      records: pageRows
        .map(toMessageLogRecord)
        .filter((record): record is ChatMessageLogRecord => record !== null),
      hasMoreBefore
    }
  }

  public async listByRun(runId: string): Promise<ChatMessageLogRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_session_message_log WHERE run_id = ? ORDER BY seq ASC')
      .all(runId) as ChatMessageLogRow[]
    return rows
      .map(toMessageLogRecord)
      .filter((record): record is ChatMessageLogRecord => record !== null)
  }

  public async deleteByRunIds(runIds: string[]): Promise<void> {
    const normalized = runIds.filter((runId) => String(runId || '').trim())
    if (normalized.length === 0) return
    const placeholders = normalized.map(() => '?').join(',')
    this.sqlite
      .prepare(`DELETE FROM chat_session_message_log WHERE run_id IN (${placeholders})`)
      .run(...normalized)
  }

  public async deleteByPartner(partnerId: string): Promise<void> {
    const safeId = String(partnerId || '').trim()
    if (!safeId) return
    this.sqlite.prepare('DELETE FROM chat_session_message_log WHERE partner_id = ?').run(safeId)
  }
}

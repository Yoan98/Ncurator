import { v4 as uuidv4 } from 'uuid'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonObject, toRequiredNumber, toRequiredString } from '../sqlite/sqliteUtils'

type ChatMessageLogRow = {
  id?: unknown
  session_id?: unknown
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
    sessionId: toRequiredString(row.session_id),
    runId: toRequiredString(row.run_id),
    seq: toRequiredNumber(row.seq),
    entry,
    createdAt: toRequiredNumber(row.created_at)
  }
}

export class ChatMessageLogStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async appendBatch(input: {
    sessionId: string
    runId: string
    entries: ChatMessageLogEntry[]
  }): Promise<ChatMessageLogRecord[]> {
    if (input.entries.length === 0) return []
    return this.sqlite.transaction(() => {
      const nextSeqRow = this.sqlite
        .prepare(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM chat_session_message_log WHERE session_id = ?'
        )
        .get(input.sessionId) as { next_seq?: unknown }
      const startSeq = toRequiredNumber(nextSeqRow.next_seq, 1)
      const insert = this.sqlite.prepare(
        `
        INSERT INTO chat_session_message_log (id, session_id, run_id, seq, entry_json, created_at)
        VALUES (@id, @session_id, @run_id, @seq, @entry_json, @created_at)
      `
      )
      const now = Date.now()
      const records: ChatMessageLogRecord[] = []
      input.entries.forEach((entry, index) => {
        const seq = startSeq + index
        const record: ChatMessageLogRecord = {
          id: uuidv4(),
          sessionId: input.sessionId,
          runId: input.runId,
          seq,
          entry,
          createdAt: now
        }
        insert.run({
          id: record.id,
          session_id: record.sessionId,
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

  public async list(sessionId: string): Promise<ChatMessageLogRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_session_message_log WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as ChatMessageLogRow[]
    return rows
      .map(toMessageLogRecord)
      .filter((record): record is ChatMessageLogRecord => record !== null)
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
}

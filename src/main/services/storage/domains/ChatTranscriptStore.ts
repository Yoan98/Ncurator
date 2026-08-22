import { v4 as uuidv4 } from 'uuid'
import type {
  ChatTranscriptEntry,
  ChatTranscriptRecord
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonObject, toRequiredNumber, toRequiredString } from '../sqlite/sqliteUtils'

type ChatTranscriptRow = {
  id?: unknown
  session_id?: unknown
  run_id?: unknown
  seq?: unknown
  entry_json?: unknown
  created_at?: unknown
}

const toTranscriptRecord = (row: ChatTranscriptRow): ChatTranscriptRecord | null => {
  const entry = parseJsonObject<ChatTranscriptEntry>(row.entry_json)
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

export class ChatTranscriptStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async appendBatch(input: {
    sessionId: string
    runId: string
    entries: ChatTranscriptEntry[]
  }): Promise<ChatTranscriptRecord[]> {
    if (input.entries.length === 0) return []
    return this.sqlite.transaction(() => {
      const nextSeqRow = this.sqlite
        .prepare(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM chat_session_transcript WHERE session_id = ?'
        )
        .get(input.sessionId) as { next_seq?: unknown }
      const startSeq = toRequiredNumber(nextSeqRow.next_seq, 1)
      const insert = this.sqlite.prepare(
        `
        INSERT INTO chat_session_transcript (id, session_id, run_id, seq, entry_json, created_at)
        VALUES (@id, @session_id, @run_id, @seq, @entry_json, @created_at)
      `
      )
      const now = Date.now()
      const records: ChatTranscriptRecord[] = []
      input.entries.forEach((entry, index) => {
        const seq = startSeq + index
        const record: ChatTranscriptRecord = {
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

  public async list(sessionId: string): Promise<ChatTranscriptRecord[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_session_transcript WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as ChatTranscriptRow[]
    return rows
      .map(toTranscriptRecord)
      .filter((record): record is ChatTranscriptRecord => record !== null)
  }
}

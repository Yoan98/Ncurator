import type {
  ChatSession
} from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  toRequiredNumber,
  toRequiredString
} from '../sqlite/sqliteUtils'

type ChatSessionRow = {
  id?: unknown
  title?: unknown
  created_at?: unknown
  updated_at?: unknown
  last_viewed_at?: unknown
  workspace_id?: unknown
}

const toSession = (row: ChatSessionRow): ChatSession => ({
  id: toRequiredString(row.id),
  title: toRequiredString(row.title),
  created_at: toRequiredNumber(row.created_at),
  workspace_id: toRequiredString(row.workspace_id)
})

export class ChatStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async saveChatSession(session: ChatSession): Promise<void> {
    const now = Date.now()
    this.sqlite
      .prepare(
        `
        INSERT INTO chat_session (id, title, created_at, updated_at, last_viewed_at, workspace_id)
        VALUES (@id, @title, @created_at, @updated_at, @last_viewed_at, @workspace_id)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at,
          workspace_id = excluded.workspace_id
      `
      )
      .run({
        id: session.id,
        title: session.title,
        created_at: session.created_at,
        updated_at: now,
        last_viewed_at: session.created_at,
        workspace_id: session.workspace_id || ''
      })
  }

  public async saveChatSessionFromWorkbenchDraft(session: ChatSession): Promise<void> {
    const now = Date.now()
    this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO chat_session (id, title, created_at, updated_at, last_viewed_at, workspace_id)
           VALUES (@id, @title, @created_at, @updated_at, @last_viewed_at, @workspace_id)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             updated_at = excluded.updated_at,
             workspace_id = excluded.workspace_id`
        )
        .run({
          id: session.id,
          title: session.title,
          created_at: session.created_at,
          updated_at: now,
          last_viewed_at: session.created_at,
          workspace_id: session.workspace_id || ''
        })
      const draft = this.sqlite
        .prepare('SELECT draft_state_json FROM workbench_ui_state WHERE id = 1')
        .get() as { draft_state_json?: unknown } | undefined
      if (draft?.draft_state_json) {
        this.sqlite
          .prepare(
            `INSERT OR REPLACE INTO chat_session_ui_state (session_id, state_json, updated_at)
             VALUES (?, ?, ?)`
          )
          .run(session.id, draft.draft_state_json, now)
      }
      this.sqlite
        .prepare(
          `INSERT INTO workbench_ui_state (id, active_view_key, draft_state_json, updated_at)
           VALUES (1, ?, NULL, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_view_key = excluded.active_view_key,
             draft_state_json = NULL,
             updated_at = excluded.updated_at`
        )
        .run(session.id, now)
      this.sqlite
        .prepare('UPDATE browser_tab_state SET owner_key = ?, updated_at = ? WHERE owner_key = ?')
        .run(session.id, now, '__draft__')
    })
  }

  public async markChatSessionViewed(sessionId: string, viewedAt = Date.now()): Promise<void> {
    this.sqlite
      .prepare('UPDATE chat_session SET last_viewed_at = ? WHERE id = ?')
      .run(viewedAt, sessionId)
  }

  public async listUnreadCompletedSessionIds(): Promise<string[]> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT DISTINCT session.id
        FROM chat_session AS session
        INNER JOIN ai_run AS run ON run.session_id = session.id
        WHERE run.status = 'completed'
          AND run.finished_at IS NOT NULL
          AND run.finished_at > session.last_viewed_at
      `
      )
      .all() as Array<{ id?: unknown }>
    return rows.map((row) => toRequiredString(row.id)).filter(Boolean)
  }

  public async getChatSession(id: string): Promise<ChatSession | null> {
    const row = this.sqlite
      .prepare(
        'SELECT id, title, created_at, updated_at, workspace_id FROM chat_session WHERE id = ?'
      )
      .get(id) as ChatSessionRow | undefined
    return row ? toSession(row) : null
  }

  public async getChatSessions(): Promise<ChatSession[]> {
    const rows = this.sqlite
      .prepare(
        'SELECT id, title, created_at, updated_at, workspace_id FROM chat_session ORDER BY updated_at DESC, created_at DESC'
      )
      .all() as ChatSessionRow[]
    return rows.map(toSession)
  }

  public async deleteChatSession(id: string): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM browser_tab_state WHERE owner_key = ?').run(id)
      this.sqlite
        .prepare(
          `UPDATE workbench_ui_state
           SET active_view_key = NULL, updated_at = ?
           WHERE id = 1 AND active_view_key = ?`
        )
        .run(Date.now(), id)
      this.sqlite.prepare('DELETE FROM chat_session WHERE id = ?').run(id)
    })
  }
}

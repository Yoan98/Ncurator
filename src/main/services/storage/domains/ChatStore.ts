import type {
  AiArtifactRef,
  ChatConversationMemory,
  ChatMessage,
  ChatSession,
  ChatSessionResumeSnapshot,
  ChatSessionResumeSnapshotRow,
  ChatSessionSkillState
} from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  jsonStringify,
  parseJsonArray,
  parseJsonObject,
  toOptionalNumber,
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

type ChatMessageRow = {
  id?: unknown
  session_id?: unknown
  seq?: unknown
  role?: unknown
  content?: unknown
  content_nodes_json?: unknown
  selected_references_json?: unknown
  attachments_json?: unknown
  artifacts_json?: unknown
  error?: unknown
  created_at?: unknown
}

export type ConversationMemoryContext = {
  memory: ChatConversationMemory | null
  recentMessages: ChatMessage[]
}

export type ConversationMemoryCompaction = ConversationMemoryContext & {
  messagesToSummarize: ChatMessage[]
  targetCoveredMessageId: string
  targetCoveredTimestamp: number
  targetCoveredMessageCount: number
}

const toChatRole = (value: unknown): ChatMessage['role'] => {
  const role = String(value || '')
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

const toSession = (row: ChatSessionRow): ChatSession => ({
  id: toRequiredString(row.id),
  title: toRequiredString(row.title),
  created_at: toRequiredNumber(row.created_at),
  workspace_id: toRequiredString(row.workspace_id)
})

const toMessage = (row: ChatMessageRow): ChatMessage & { seq?: number } => ({
  id: toRequiredString(row.id),
  session_id: toRequiredString(row.session_id),
  role: toChatRole(row.role),
  content: toRequiredString(row.content),
  timestamp: toRequiredNumber(row.created_at),
  seq: toOptionalNumber(row.seq),
  contentNodes: parseJsonArray(row.content_nodes_json),
  selectedReferences: parseJsonArray(row.selected_references_json),
  attachments: parseJsonArray(row.attachments_json),
  artifacts: parseJsonArray<AiArtifactRef>(row.artifacts_json),
  error: row.error === 1 || row.error === true ? true : undefined
})

export class ChatStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  private isValidConversationMemory(value: unknown): value is ChatConversationMemory {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<ChatConversationMemory>
    return (
      typeof record.summary === 'string' &&
      (typeof record.coveredMessageId === 'string' || record.coveredMessageId === null) &&
      (typeof record.coveredTimestamp === 'number' || record.coveredTimestamp === null) &&
      typeof record.coveredMessageCount === 'number' &&
      typeof record.updatedAt === 'number'
    )
  }

  private readConversationMemory(sessionId: string): ChatConversationMemory | null {
    const row = this.sqlite
      .prepare('SELECT memory_json FROM chat_conversation_memory WHERE session_id = ?')
      .get(sessionId) as { memory_json?: unknown } | undefined
    const memory = parseJsonObject(row?.memory_json)
    return this.isValidConversationMemory(memory)
      ? {
          ...memory,
          revision: typeof memory.revision === 'number' ? memory.revision : 0
        }
      : null
  }

  private findFirstMessageAfterMemory(
    messages: ChatMessage[],
    memory: ChatConversationMemory | null
  ): number {
    if (!memory?.coveredMessageId) return 0

    const coveredIndex = messages.findIndex((message) => message.id === memory.coveredMessageId)
    if (coveredIndex >= 0) return coveredIndex + 1

    if (typeof memory.coveredTimestamp === 'number') {
      const firstRecentIndex = messages.findIndex(
        (message) => message.timestamp > Number(memory.coveredTimestamp)
      )
      return firstRecentIndex >= 0 ? firstRecentIndex : messages.length
    }
    return 0
  }

  public async saveConversationMemory(
    sessionId: string,
    memory: ChatConversationMemory
  ): Promise<void> {
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO chat_conversation_memory (session_id, memory_json, updated_at)
        VALUES (@session_id, @memory_json, @updated_at)
      `
      )
      .run({
        session_id: sessionId,
        memory_json: JSON.stringify(memory),
        updated_at: memory.updatedAt || Date.now()
      })
  }

  public async getConversationMemory(sessionId: string): Promise<ChatConversationMemory | null> {
    return this.readConversationMemory(sessionId)
  }

  public async saveConversationMemoryIfCurrent(input: {
    sessionId: string
    expectedRevision: number
    expectedCoveredMessageId: string | null
    expectedUpdatedAt: number | null
    memory: ChatConversationMemory
  }): Promise<boolean> {
    return this.sqlite.transaction(() => {
      const current = this.readConversationMemory(input.sessionId)
      if (
        (current?.revision || 0) !== input.expectedRevision ||
        (current?.coveredMessageId || null) !== input.expectedCoveredMessageId ||
        (current?.updatedAt || null) !== input.expectedUpdatedAt
      ) {
        return false
      }
      this.sqlite
        .prepare(
          `
          INSERT OR REPLACE INTO chat_conversation_memory (session_id, memory_json, updated_at)
          VALUES (@session_id, @memory_json, @updated_at)
        `
        )
        .run({
          session_id: input.sessionId,
          memory_json: JSON.stringify(input.memory),
          updated_at: input.memory.updatedAt
        })
      return true
    })
  }

  public async clearConversationMemory(sessionId: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM chat_conversation_memory WHERE session_id = ?').run(sessionId)
  }

  public async saveSessionResumeSnapshot(
    sessionId: string,
    snapshot: ChatSessionResumeSnapshot
  ): Promise<void> {
    this.sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO chat_session_resume_snapshot (
          session_id, run_id, reason, user_input, selected_references_json, workspace_json,
          human_state_json, error_message, updated_at
        ) VALUES (
          @session_id, @run_id, @reason, @user_input, @selected_references_json, @workspace_json,
          @human_state_json, @error_message, @updated_at
        )
      `
      )
      .run({
        session_id: sessionId,
        run_id: snapshot.runId,
        reason: snapshot.reason,
        user_input: snapshot.userInput,
        selected_references_json: JSON.stringify(snapshot.selectedReferences || []),
        workspace_json: jsonStringify(snapshot.workspace),
        human_state_json: JSON.stringify(snapshot.humanState),
        error_message: snapshot.errorMessage,
        updated_at: snapshot.updatedAt
      })
  }

  public async getSessionResumeSnapshot(
    sessionId: string
  ): Promise<ChatSessionResumeSnapshot | null> {
    const row = this.sqlite
      .prepare('SELECT * FROM chat_session_resume_snapshot WHERE session_id = ?')
      .get(sessionId) as ChatSessionResumeSnapshotRow | undefined
    if (!row?.human_state_json) return null
    try {
      const selectedReferences = JSON.parse(String(row.selected_references_json || '[]'))
      const workspace = row.workspace_json ? JSON.parse(String(row.workspace_json)) : undefined
      const humanState = JSON.parse(String(row.human_state_json))
      if (!humanState || humanState.schemaVersion !== 2) return null
      const reasonText = String(row.reason || '')
      const reason =
        reasonText === 'network_error' ||
        reasonText === 'user_cancelled' ||
        reasonText === 'process_interrupted' ||
        reasonText === 'runtime_limit' ||
        reasonText === 'unexpected_error'
          ? reasonText
          : 'timeout'
      return {
        reason,
        runId: String(row.run_id || ''),
        userInput: String(row.user_input || ''),
        selectedReferences: Array.isArray(selectedReferences) ? selectedReferences : [],
        workspace,
        humanState,
        errorMessage: String(row.error_message || ''),
        updatedAt: Number(row.updated_at || 0)
      }
    } catch {
      return null
    }
  }

  public async clearSessionResumeSnapshot(sessionId: string): Promise<void> {
    this.sqlite
      .prepare('DELETE FROM chat_session_resume_snapshot WHERE session_id = ?')
      .run(sessionId)
  }

  public async getSessionSkillState(sessionId: string): Promise<ChatSessionSkillState> {
    const row = this.sqlite
      .prepare(
        'SELECT state_json, revision, updated_at FROM chat_session_skill_state WHERE session_id = ?'
      )
      .get(sessionId) as
      | { state_json?: unknown; revision?: unknown; updated_at?: unknown }
      | undefined
    if (!row?.state_json) {
      return {
        schemaVersion: 1,
        learnedSkillIds: [],
        revision: 0,
        updatedAt: 0,
        lastUpdatedRunId: ''
      }
    }
    try {
      const parsed = JSON.parse(String(row.state_json)) as Partial<ChatSessionSkillState>
      return {
        schemaVersion: 1,
        learnedSkillIds: Array.isArray(parsed.learnedSkillIds)
          ? parsed.learnedSkillIds.map((id) => String(id).trim()).filter(Boolean)
          : [],
        revision: Number(row.revision || parsed.revision || 0),
        updatedAt: Number(row.updated_at || parsed.updatedAt || 0),
        lastUpdatedRunId: String(parsed.lastUpdatedRunId || '')
      }
    } catch {
      return {
        schemaVersion: 1,
        learnedSkillIds: [],
        revision: Number(row.revision || 0),
        updatedAt: Number(row.updated_at || 0),
        lastUpdatedRunId: ''
      }
    }
  }

  public async saveSessionSkillStateIfCurrent(input: {
    sessionId: string
    expectedRevision: number
    learnedSkillIds: string[]
    runId: string
  }): Promise<ChatSessionSkillState | null> {
    return this.sqlite.transaction(() => {
      const current = this.sqlite
        .prepare('SELECT revision FROM chat_session_skill_state WHERE session_id = ?')
        .get(input.sessionId) as { revision?: unknown } | undefined
      const currentRevision = Number(current?.revision || 0)
      if (currentRevision !== input.expectedRevision) return null
      const next: ChatSessionSkillState = {
        schemaVersion: 1,
        learnedSkillIds: [...input.learnedSkillIds],
        revision: currentRevision + 1,
        updatedAt: Date.now(),
        lastUpdatedRunId: input.runId
      }
      this.sqlite
        .prepare(
          `INSERT OR REPLACE INTO chat_session_skill_state
             (session_id, state_json, revision, updated_at)
           VALUES (@session_id, @state_json, @revision, @updated_at)`
        )
        .run({
          session_id: input.sessionId,
          state_json: JSON.stringify(next),
          revision: next.revision,
          updated_at: next.updatedAt
        })
      return next
    })
  }

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
      this.sqlite.prepare('DELETE FROM chat_session WHERE id = ?').run(id)
    })
  }

  public async deleteChatMessagesByIds(messageIds: string[]): Promise<void> {
    const ids = messageIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (ids.length === 0) return
    this.sqlite.transaction(() => {
      const stmt = this.sqlite.prepare('DELETE FROM chat_message WHERE id = ?')
      for (const id of ids) stmt.run(id)
    })
  }

  public async saveChatMessage(message: ChatMessage): Promise<void> {
    this.sqlite.transaction(() => {
      const existing = this.sqlite
        .prepare('SELECT seq FROM chat_message WHERE id = ?')
        .get(message.id) as { seq?: unknown } | undefined
      const seq =
        toOptionalNumber(existing?.seq) ||
        ((
          this.sqlite
            .prepare(
              'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM chat_message WHERE session_id = ?'
            )
            .get(message.session_id) as { next_seq?: unknown }
        ).next_seq as number)
      const createdAt = message.timestamp || Date.now()

      this.sqlite
        .prepare(
          `
          INSERT INTO chat_message (
            id, session_id, seq, role, content, content_nodes_json, selected_references_json,
            attachments_json, artifacts_json, error, created_at
          ) VALUES (
            @id, @session_id, @seq, @role, @content, @content_nodes_json, @selected_references_json,
            @attachments_json, @artifacts_json, @error, @created_at
          )
          ON CONFLICT(id) DO UPDATE SET
            session_id = excluded.session_id,
            seq = excluded.seq,
            role = excluded.role,
            content = excluded.content,
            content_nodes_json = excluded.content_nodes_json,
            selected_references_json = excluded.selected_references_json,
            attachments_json = excluded.attachments_json,
            artifacts_json = excluded.artifacts_json,
            error = excluded.error,
            created_at = excluded.created_at
        `
        )
        .run({
          id: message.id,
          session_id: message.session_id,
          seq,
          role: message.role,
          content: message.content,
          content_nodes_json: jsonStringify(message.contentNodes),
          selected_references_json: jsonStringify(message.selectedReferences),
          attachments_json: jsonStringify(message.attachments),
          artifacts_json: jsonStringify(message.artifacts),
          error: message.error ? 1 : null,
          created_at: createdAt
        })

      this.sqlite
        .prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?')
        .run(createdAt, message.session_id)
    })
  }

  public async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_message WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as ChatMessageRow[]
    return rows.map(toMessage)
  }

  public async getChatMessagesPage(input: {
    sessionId: string
    limit: number
    beforeTimestamp?: number
  }): Promise<{ messages: ChatMessage[]; hasMoreBefore: boolean }> {
    const safeLimit = Math.max(1, Math.min(100, Number(input.limit || 50)))
    const beforeTimestamp = Number(input.beforeTimestamp)
    const params = {
      session_id: input.sessionId,
      before: Number.isFinite(beforeTimestamp) ? Math.floor(beforeTimestamp) : null,
      limit: safeLimit + 1
    }
    const rows = this.sqlite
      .prepare(
        `
        SELECT * FROM chat_message
        WHERE session_id = @session_id
          AND (@before IS NULL OR created_at < @before)
        ORDER BY seq DESC
        LIMIT @limit
      `
      )
      .all(params) as ChatMessageRow[]
    const hasMoreBefore = rows.length > safeLimit
    const pageRows = rows.slice(0, safeLimit).reverse()
    return {
      messages: pageRows.map(toMessage),
      hasMoreBefore
    }
  }

  public async getMessagesAfterConversationMemory(sessionId: string): Promise<ChatMessage[]> {
    return (await this.getConversationMemoryContext(sessionId)).recentMessages
  }

  public async getConversationMemoryContext(sessionId: string): Promise<ConversationMemoryContext> {
    return this.sqlite.transaction(() => {
      const memory = this.readConversationMemory(sessionId)
      const rows = this.sqlite
        .prepare('SELECT * FROM chat_message WHERE session_id = ? ORDER BY seq ASC')
        .all(sessionId) as ChatMessageRow[]
      const messages = rows.map(toMessage)
      const startIndex = this.findFirstMessageAfterMemory(messages, memory)
      return {
        memory,
        recentMessages: messages.slice(startIndex)
      }
    })
  }

  public async getConversationMemoryCompaction(input: {
    sessionId: string
    recentTurns: number
    triggerTurns: number
  }): Promise<ConversationMemoryCompaction | null> {
    const context = await this.getConversationMemoryContext(input.sessionId)
    const recentTurns = Math.floor(input.recentTurns)
    const triggerTurns = Math.floor(input.triggerTurns)
    if (recentTurns < 1 || triggerTurns <= recentTurns) {
      throw new Error('conversation_memory_turn_config_invalid')
    }
    const turnStartIndexes: number[] = []
    for (let index = 0; index < context.recentMessages.length; index += 1) {
      if (context.recentMessages[index].role !== 'user') continue
      const nextUserIndex = context.recentMessages.findIndex(
        (message, candidateIndex) => candidateIndex > index && message.role === 'user'
      )
      const turnEndIndex = nextUserIndex >= 0 ? nextUserIndex : context.recentMessages.length
      if (
        context.recentMessages
          .slice(index + 1, turnEndIndex)
          .some((message) => message.role === 'assistant')
      ) {
        turnStartIndexes.push(index)
      }
    }
    if (turnStartIndexes.length < triggerTurns) return null

    const firstRetainedTurnIndex = turnStartIndexes[turnStartIndexes.length - recentTurns]
    const messagesToSummarize = context.recentMessages.slice(0, firstRetainedTurnIndex)
    const target = messagesToSummarize.at(-1)
    if (!target) return null

    return {
      ...context,
      messagesToSummarize,
      targetCoveredMessageId: target.id,
      targetCoveredTimestamp: target.timestamp,
      targetCoveredMessageCount:
        (context.memory?.coveredMessageCount || 0) + messagesToSummarize.length
    }
  }

  public async getRecentChatMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    const result = await this.getChatMessagesPage({ sessionId, limit })
    return result.messages
  }
}

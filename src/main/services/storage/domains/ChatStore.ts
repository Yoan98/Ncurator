import type {
  ChatConversationMemory,
  ChatMessage,
  ChatSession,
  ChatSessionResumeSnapshot,
  ChatSessionResumeSnapshotRow
} from '../../../types/store'
import type { AiArtifactRef } from '../../../types/store'
import { LanceDbCore, LANCE_TABLES } from '../core/LanceDbCore'

type ChatSessionRow = { id?: unknown; title?: unknown; created_at?: unknown }
type ChatMessageRow = {
  id?: unknown
  session_id?: unknown
  role?: unknown
  content?: unknown
  timestamp?: unknown
  sources?: unknown
  artifacts_json?: unknown
  error?: unknown
}

const toChatRole = (value: unknown): ChatMessage['role'] => {
  const role = String(value || '')
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

const parseArtifacts = (value: unknown): AiArtifactRef[] | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(String(value)) as AiArtifactRef[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export class ChatStore {
  public constructor(private readonly core: LanceDbCore) {}

  public async saveConversationMemory(sessionId: string, memory: ChatConversationMemory): Promise<void> {
    const safeId = this.core.escapeSqlString(sessionId)
    const table = await this.core.openTable(LANCE_TABLES.CHAT_CONVERSATION_MEMORY)
    await table.delete(`session_id = '${safeId}'`)
    await table.add([
      {
        session_id: sessionId,
        memory_json: JSON.stringify(memory),
        updated_at: Date.now()
      }
    ])
  }

  public async getConversationMemory(sessionId: string): Promise<ChatConversationMemory | null> {
    const safeId = this.core.escapeSqlString(sessionId)
    const table = await this.core.openTable(LANCE_TABLES.CHAT_CONVERSATION_MEMORY)
    const rows = await table.query().where(`session_id = '${safeId}'`).toArray()
    const row = rows?.[0]
    if (!row?.memory_json) return null
    try {
      return JSON.parse(String(row.memory_json)) as ChatConversationMemory
    } catch (e) {
      void e
      return null
    }
  }

  public async saveSessionResumeSnapshot(
    sessionId: string,
    snapshot: ChatSessionResumeSnapshot
  ): Promise<void> {
    const safeId = this.core.escapeSqlString(sessionId)
    const table = await this.core.openTable(LANCE_TABLES.CHAT_SESSION_RESUME_SNAPSHOT)
    await table.delete(`session_id = '${safeId}'`)
    await table.add([
      {
        session_id: sessionId,
        run_id: snapshot.runId,
        reason: snapshot.reason,
        user_input: snapshot.userInput,
        selected_references_json: JSON.stringify(snapshot.selectedReferences || []),
        workspace_json: snapshot.workspace ? JSON.stringify(snapshot.workspace) : undefined,
        human_state_json: JSON.stringify(snapshot.humanState),
        error_message: snapshot.errorMessage,
        updated_at: snapshot.updatedAt
      }
    ])
  }

  public async getSessionResumeSnapshot(
    sessionId: string
  ): Promise<ChatSessionResumeSnapshot | null> {
    const safeId = this.core.escapeSqlString(sessionId)
    const table = await this.core.openTable(LANCE_TABLES.CHAT_SESSION_RESUME_SNAPSHOT)
    const rows = await table.query().where(`session_id = '${safeId}'`).toArray()
    const row = rows?.[0] as ChatSessionResumeSnapshotRow | undefined
    if (!row?.human_state_json) return null
    try {
      const selectedReferences = JSON.parse(String(row.selected_references_json || '[]'))
      const workspace = row.workspace_json ? JSON.parse(String(row.workspace_json)) : undefined
      const humanState = JSON.parse(String(row.human_state_json))
      return {
        reason:
          String(row.reason) === 'network_error'
            ? 'network_error'
            : 'timeout',
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
    const safeId = this.core.escapeSqlString(sessionId)
    const table = await this.core.openTable(LANCE_TABLES.CHAT_SESSION_RESUME_SNAPSHOT)
    await table.delete(`session_id = '${safeId}'`)
  }

  public async saveChatSession(session: ChatSession): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.CHAT_SESSION)
    await table.delete(`id = '${this.core.escapeSqlString(session.id)}'`)
    await table.add([{ ...session }])
  }

  public async getChatSessions(): Promise<ChatSession[]> {
    const table = await this.core.openTable(LANCE_TABLES.CHAT_SESSION)
    const results = await table.query().toArray()
    return results
      .map((r) => {
        const row = r as ChatSessionRow
        return {
          id: String(row.id || ''),
          title: String(row.title || ''),
          created_at: Number(row.created_at || 0)
        }
      })
      .sort((a, b) => b.created_at - a.created_at)
  }

  public async deleteChatSession(id: string): Promise<void> {
    const safeId = this.core.escapeSqlString(id)
    const sessionTable = await this.core.openTable(LANCE_TABLES.CHAT_SESSION)
    await sessionTable.delete(`id = '${safeId}'`)

    const msgTable = await this.core.openTable(LANCE_TABLES.CHAT_MESSAGE)
    await msgTable.delete(`session_id = '${safeId}'`)

    const memoryTable = await this.core.openTable(LANCE_TABLES.CHAT_CONVERSATION_MEMORY)
    await memoryTable.delete(`session_id = '${safeId}'`)

    const resumeTable = await this.core.openTable(LANCE_TABLES.CHAT_SESSION_RESUME_SNAPSHOT)
    await resumeTable.delete(`session_id = '${safeId}'`)
  }

  public async saveChatMessage(message: ChatMessage): Promise<void> {
    const table = await this.core.openTable(LANCE_TABLES.CHAT_MESSAGE)
    await table.delete(`id = '${this.core.escapeSqlString(message.id)}'`)
    await table.add([
      {
        id: message.id,
        session_id: message.session_id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        sources: message.sources,
        error: message.error,
        artifacts_json: message.artifacts ? JSON.stringify(message.artifacts) : undefined
      }
    ])
  }

  public async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    const table = await this.core.openTable(LANCE_TABLES.CHAT_MESSAGE)
    const results = await table
      .query()
      .where(`session_id = '${this.core.escapeSqlString(sessionId)}'`)
      .toArray()
    return results
      .map((r) => {
        const row = r as ChatMessageRow
        return {
          id: String(row.id || ''),
          session_id: String(row.session_id || ''),
          role: toChatRole(row.role),
          content: String(row.content || ''),
          timestamp: Number(row.timestamp || 0),
          sources: row.sources ? String(row.sources) : undefined,
          artifacts: parseArtifacts(row.artifacts_json),
          error: typeof row.error === 'boolean' ? row.error : undefined
        }
      })
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  public async getRecentChatMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    const n = Math.max(1, Math.min(50, Number(limit || 0)))
    const all = await this.getChatMessages(sessionId)
    if (all.length <= n) return all
    return all.slice(all.length - n)
  }
}

import { v4 as uuidv4 } from 'uuid'
import type {
  ChatAttachment,
  ChatMessage,
  ChatMessageContentNode,
  SelectedReference
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonArray, toRequiredNumber, toRequiredString } from '../sqlite/sqliteUtils'

type ChatSearchTurnRow = {
  id?: unknown
  session_id?: unknown
  seq?: unknown
  role?: unknown
  content?: unknown
  content_nodes_json?: unknown
  selected_references_json?: unknown
  attachments_json?: unknown
  created_at?: unknown
}

const toChatRole = (value: unknown): ChatMessage['role'] => {
  const role = String(value || '')
  if (role === 'assistant' || role === 'system') return role
  return 'user'
}

const toMessage = (row: ChatSearchTurnRow): ChatMessage => ({
  id: toRequiredString(row.id),
  session_id: toRequiredString(row.session_id),
  role: toChatRole(row.role),
  content: toRequiredString(row.content),
  timestamp: toRequiredNumber(row.created_at),
  contentNodes: parseJsonArray<ChatMessageContentNode>(row.content_nodes_json),
  selectedReferences: parseJsonArray<SelectedReference>(row.selected_references_json),
  attachments: parseJsonArray<ChatAttachment>(row.attachments_json)
})

export class ChatSearchTurnStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async appendTurn(input: {
    sessionId: string
    role: ChatMessage['role']
    content: string
    contentNodes?: ChatMessageContentNode[]
    selectedReferences?: SelectedReference[]
    attachments?: ChatAttachment[]
    searchDocumentIds?: string[]
    resultPayload?: unknown
    createdAt?: number
  }): Promise<ChatMessage> {
    return this.sqlite.transaction(() => {
      const nextSeqRow = this.sqlite
        .prepare(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM chat_search_turn WHERE session_id = ?'
        )
        .get(input.sessionId) as { next_seq?: unknown }
      const seq = toRequiredNumber(nextSeqRow.next_seq, 1)
      const createdAt = input.createdAt ?? Date.now()
      const message: ChatMessage = {
        id: uuidv4(),
        session_id: input.sessionId,
        role: input.role,
        content: input.content,
        timestamp: createdAt,
        contentNodes: input.contentNodes,
        selectedReferences: input.selectedReferences,
        attachments: input.attachments
      }
      this.sqlite
        .prepare(
          `
          INSERT INTO chat_search_turn (
            id, session_id, seq, role, content, search_document_ids_json, result_payload_json,
            content_nodes_json, selected_references_json, attachments_json, created_at
          ) VALUES (
            @id, @session_id, @seq, @role, @content, @search_document_ids_json, @result_payload_json,
            @content_nodes_json, @selected_references_json, @attachments_json, @created_at
          )
        `
        )
        .run({
          id: message.id,
          session_id: message.session_id,
          seq,
          role: message.role,
          content: message.content,
          search_document_ids_json: jsonStringify(input.searchDocumentIds),
          result_payload_json: jsonStringify(input.resultPayload),
          content_nodes_json: jsonStringify(message.contentNodes),
          selected_references_json: jsonStringify(message.selectedReferences),
          attachments_json: jsonStringify(message.attachments),
          created_at: createdAt
        })
      this.sqlite
        .prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?')
        .run(createdAt, input.sessionId)
      return message
    })
  }

  public async list(sessionId: string): Promise<ChatMessage[]> {
    const rows = this.sqlite
      .prepare('SELECT * FROM chat_search_turn WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as ChatSearchTurnRow[]
    return rows.map(toMessage)
  }
}

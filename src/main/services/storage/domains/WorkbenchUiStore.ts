import type {
  ChatSessionUiStateV1,
  WorkbenchUiState,
  WorkbenchUiStateSaveRequest
} from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonObject, toRequiredNumber } from '../sqlite/sqliteUtils'

type SessionUiStateRow = {
  state_json?: unknown
  updated_at?: unknown
}

type WorkbenchUiStateRow = {
  active_view_key?: unknown
  draft_state_json?: unknown
  updated_at?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isChatSessionUiStateV1 = (value: unknown): value is ChatSessionUiStateV1 => {
  if (!isRecord(value) || value.version !== 1) return false
  const composer = value.composer
  const panel = value.panel
  if (!isRecord(composer) || !isRecord(panel)) return false
  if (composer.mode !== 'ai' && composer.mode !== 'search') return false
  if (
    composer.aiPreference !== 'default' &&
    composer.aiPreference !== 'local_sources_relaxed' &&
    composer.aiPreference !== 'local_sources_strict'
  ) {
    return false
  }
  if (!isRecord(composer.modelSelection) || !isRecord(composer.draft)) return false
  if (typeof composer.workspaceId !== 'string' && composer.workspaceId !== null) return false
  if (
    typeof composer.draft.input !== 'string' ||
    !Array.isArray(composer.draft.contentNodes) ||
    !Array.isArray(composer.draft.selectedReferences) ||
    !Array.isArray(composer.draft.attachments)
  ) {
    return false
  }
  return (
    Array.isArray(panel.tabs) &&
    (typeof panel.activeTabId === 'string' || panel.activeTabId === null) &&
    typeof panel.collapsed === 'boolean' &&
    isRecord(panel.fallbackState)
  )
}

const parseUiState = (value: unknown): ChatSessionUiStateV1 | null => {
  const parsed = parseJsonObject(value)
  return isChatSessionUiStateV1(parsed) ? parsed : null
}

export class WorkbenchUiStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async getSessionState(sessionId: string): Promise<ChatSessionUiStateV1 | null> {
    const id = String(sessionId || '').trim()
    if (!id) return null
    const row = this.sqlite
      .prepare('SELECT state_json, updated_at FROM chat_session_ui_state WHERE session_id = ?')
      .get(id) as SessionUiStateRow | undefined
    return row ? parseUiState(row.state_json) : null
  }

  public async saveSessionState(sessionId: string, state: ChatSessionUiStateV1): Promise<number> {
    const id = String(sessionId || '').trim()
    if (!id) throw new Error('sessionId is required')
    if (!isChatSessionUiStateV1(state)) throw new Error('invalid session UI state')
    const sessionExists = this.sqlite
      .prepare('SELECT 1 FROM chat_session WHERE id = ?')
      .get(id)
    if (!sessionExists) throw new Error('chat session not found')
    const updatedAt = Date.now()
    this.sqlite
      .prepare(
        `INSERT INTO chat_session_ui_state (session_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`
      )
      .run(id, jsonStringify(state), updatedAt)
    return updatedAt
  }

  public async getWorkbenchState(): Promise<WorkbenchUiState> {
    const row = this.sqlite
      .prepare('SELECT active_view_key, draft_state_json, updated_at FROM workbench_ui_state WHERE id = 1')
      .get() as WorkbenchUiStateRow | undefined
    if (!row) return { activeViewKey: null, draftState: null, updatedAt: 0 }
    const activeViewKey = String(row.active_view_key || '').trim() || null
    return {
      activeViewKey,
      draftState: parseUiState(row.draft_state_json),
      updatedAt: toRequiredNumber(row.updated_at)
    }
  }

  public async saveWorkbenchState(input: WorkbenchUiStateSaveRequest): Promise<WorkbenchUiState> {
    if (input.draftState && !isChatSessionUiStateV1(input.draftState)) {
      throw new Error('invalid workbench draft state')
    }
    const activeViewKey = String(input.activeViewKey || '').trim() || null
    const updatedAt = Date.now()
    this.sqlite
      .prepare(
        `INSERT INTO workbench_ui_state (id, active_view_key, draft_state_json, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_view_key = excluded.active_view_key,
           draft_state_json = excluded.draft_state_json,
           updated_at = excluded.updated_at`
      )
      .run(activeViewKey, jsonStringify(input.draftState), updatedAt)
    return { activeViewKey, draftState: input.draftState, updatedAt }
  }
}

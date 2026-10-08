import type {
  PartnerUiStateV1,
  WorkbenchUiState,
  WorkbenchUiStateSaveRequest
} from '../../../../shared/types'
import {
  chatContentText,
  chatReferences,
  persistentChatContent
} from '../../../../shared/chatContent'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonObject, toRequiredNumber } from '../sqlite/sqliteUtils'

type PartnerUiStateRow = {
  state_json?: unknown
  updated_at?: unknown
}

type WorkbenchUiStateRow = {
  active_view_key?: unknown
  updated_at?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createEmptyPartnerUiState = (): PartnerUiStateV1 => ({
  version: 1,
  composer: {
    aiPreference: 'default',
    executionPermission: 'review',
    modelSelection: { mainModel: null },
    draft: {
      formatVersion: 2,
      input: '',
      contentNodes: [],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: true,
    fallbackState: { kind: 'empty', title: '', description: '' }
  }
})

export const isPartnerUiStateV1 = (value: unknown): value is PartnerUiStateV1 => {
  if (!isRecord(value) || value.version !== 1) return false
  const composer = value.composer
  const panel = value.panel
  if (!isRecord(composer) || !isRecord(panel)) return false
  if (
    composer.aiPreference !== 'default' &&
    composer.aiPreference !== 'local_sources_relaxed' &&
    composer.aiPreference !== 'local_sources_strict'
  ) {
    return false
  }
  if (!isRecord(composer.modelSelection) || !isRecord(composer.draft)) return false
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

const parseUiState = (value: unknown): PartnerUiStateV1 | null => {
  const parsed = parseJsonObject(value)
  return isPartnerUiStateV1(parsed) ? parsed : null
}

export class WorkbenchUiStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async getPartnerState(partnerId: string): Promise<PartnerUiStateV1 | null> {
    const id = String(partnerId || '').trim()
    if (!id) return null
    const row = this.sqlite
      .prepare('SELECT state_json, updated_at FROM partner_ui_state WHERE partner_id = ?')
      .get(id) as PartnerUiStateRow | undefined
    return row ? parseUiState(row.state_json) : null
  }

  public async savePartnerState(partnerId: string, state: PartnerUiStateV1): Promise<number> {
    const id = String(partnerId || '').trim()
    if (!id) throw new Error('partnerId is required')
    if (!isPartnerUiStateV1(state)) throw new Error('invalid partner UI state')
    const partnerExists = this.sqlite.prepare('SELECT 1 FROM partner WHERE id = ?').get(id)
    if (!partnerExists) throw new Error('partner not found')
    const contentNodes = persistentChatContent(state.composer.draft.contentNodes)
    const persistedState: PartnerUiStateV1 = {
      ...state,
      composer: {
        ...state.composer,
        draft: {
          ...state.composer.draft,
          contentNodes,
          input: chatContentText(contentNodes).trim(),
          selectedReferences: chatReferences(contentNodes)
        }
      }
    }
    const updatedAt = Date.now()
    this.sqlite
      .prepare(
        `INSERT INTO partner_ui_state (partner_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(partner_id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`
      )
      .run(id, jsonStringify(persistedState), updatedAt)
    return updatedAt
  }

  public async getWorkbenchState(): Promise<WorkbenchUiState> {
    const row = this.sqlite
      .prepare('SELECT active_view_key, updated_at FROM workbench_ui_state WHERE id = 1')
      .get() as WorkbenchUiStateRow | undefined
    if (!row) return { activeViewKey: null, updatedAt: 0 }
    const activeViewKey = String(row.active_view_key || '').trim() || null
    return {
      activeViewKey,
      updatedAt: toRequiredNumber(row.updated_at)
    }
  }

  public async saveWorkbenchState(input: WorkbenchUiStateSaveRequest): Promise<WorkbenchUiState> {
    const activeViewKey = String(input.activeViewKey || '').trim() || null
    const updatedAt = Date.now()
    this.sqlite
      .prepare(
        `INSERT INTO workbench_ui_state (id, active_view_key, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_view_key = excluded.active_view_key,
           updated_at = excluded.updated_at`
      )
      .run(activeViewKey, updatedAt)
    return { activeViewKey, updatedAt }
  }
}

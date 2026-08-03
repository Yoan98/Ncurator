import type { NavigationEntry } from 'electron'
import type { SqliteCore } from '../sqlite/SqliteCore'
import { jsonStringify, parseJsonObject, toRequiredNumber, toRequiredString } from '../sqlite/sqliteUtils'

export type PersistedBrowserTabState = {
  id: string
  ownerId: string
  title?: string
  url: string
  zoomFactor: number
  history?: { entries: NavigationEntry[]; index: number }
  position: number
  createdAt: number
  updatedAt: number
}

type BrowserTabStateRow = {
  id?: unknown
  owner_key?: unknown
  title?: unknown
  url?: unknown
  zoom_factor?: unknown
  history_json?: unknown
  position?: unknown
  created_at?: unknown
  updated_at?: unknown
}

const toState = (row: BrowserTabStateRow): PersistedBrowserTabState => {
  const history = parseJsonObject<PersistedBrowserTabState['history']>(row.history_json)
  return {
    id: toRequiredString(row.id),
    ownerId: toRequiredString(row.owner_key),
    ...(row.title ? { title: toRequiredString(row.title) } : {}),
    url: toRequiredString(row.url),
    zoomFactor: toRequiredNumber(row.zoom_factor, 1),
    ...(history && Array.isArray(history.entries) && Number.isInteger(history.index)
      ? { history }
      : {}),
    position: toRequiredNumber(row.position),
    createdAt: toRequiredNumber(row.created_at),
    updatedAt: toRequiredNumber(row.updated_at)
  }
}

export class BrowserTabStateStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public listByOwner(ownerId: string): PersistedBrowserTabState[] {
    return (
      this.sqlite
        .prepare(
          `SELECT * FROM browser_tab_state
           WHERE owner_key = ?
           ORDER BY position ASC, created_at ASC`
        )
        .all(String(ownerId || '').trim()) as BrowserTabStateRow[]
    ).map(toState)
  }

  public save(state: PersistedBrowserTabState): void {
    this.sqlite
      .prepare(
        `INSERT INTO browser_tab_state (
           id, owner_key, title, url, zoom_factor, history_json,
           position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_key = excluded.owner_key,
           title = excluded.title,
           url = excluded.url,
           zoom_factor = excluded.zoom_factor,
           history_json = excluded.history_json,
           position = excluded.position,
           updated_at = excluded.updated_at`
      )
      .run(
        state.id,
        state.ownerId,
        state.title || null,
        state.url,
        state.zoomFactor,
        jsonStringify(state.history),
        state.position,
        state.createdAt,
        state.updatedAt
      )
  }

  public delete(tabId: string): void {
    this.sqlite.prepare('DELETE FROM browser_tab_state WHERE id = ?').run(tabId)
  }

  public deleteByOwner(ownerId: string): void {
    this.sqlite.prepare('DELETE FROM browser_tab_state WHERE owner_key = ?').run(ownerId)
  }

  public promoteOwner(fromOwnerId: string, toOwnerId: string): void {
    this.sqlite
      .prepare('UPDATE browser_tab_state SET owner_key = ?, updated_at = ? WHERE owner_key = ?')
      .run(toOwnerId, Date.now(), fromOwnerId)
  }
}

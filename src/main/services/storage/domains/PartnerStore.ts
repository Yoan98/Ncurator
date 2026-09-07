import type { Partner, PartnerAvatarColor, PartnerAvatarShape } from '../../../types/store'
import type { SqliteCore } from '../sqlite/SqliteCore'
import {
  fromSqliteBoolean,
  toOptionalNumber,
  toRequiredNumber,
  toRequiredString,
  toSqliteBoolean
} from '../sqlite/sqliteUtils'

type PartnerRow = {
  id?: unknown
  name?: unknown
  avatar_shape?: unknown
  avatar_color?: unknown
  created_at?: unknown
  updated_at?: unknown
  last_viewed_at?: unknown
  pinned?: unknown
  pinned_at?: unknown
}

const AVATAR_SHAPES = new Set([
  'circle',
  'rounded_square',
  'pill',
  'hexagon',
  'cloud',
  'teardrop'
])

const AVATAR_COLORS = new Set([
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'light_grey',
  'dark_grey'
])

const toAvatarShape = (value: unknown): PartnerAvatarShape => {
  const normalized = String(value || '').trim()
  return AVATAR_SHAPES.has(normalized) ? (normalized as PartnerAvatarShape) : 'circle'
}

const toAvatarColor = (value: unknown): PartnerAvatarColor => {
  const normalized = String(value || '').trim()
  return AVATAR_COLORS.has(normalized) ? (normalized as PartnerAvatarColor) : 'brown'
}

const toPartner = (row: PartnerRow): Partner => ({
  id: toRequiredString(row.id),
  name: toRequiredString(row.name),
  avatar_shape: toAvatarShape(row.avatar_shape),
  avatar_color: toAvatarColor(row.avatar_color),
  created_at: toRequiredNumber(row.created_at),
  updated_at: toRequiredNumber(row.updated_at),
  last_viewed_at: toRequiredNumber(row.last_viewed_at),
  pinned: fromSqliteBoolean(row.pinned),
  pinned_at: toOptionalNumber(row.pinned_at) ?? null
})

const PARTNER_SELECT_COLUMNS =
  'id, name, avatar_shape, avatar_color, created_at, updated_at, last_viewed_at, pinned, pinned_at'

export class PartnerStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public async savePartner(partner: Partner): Promise<void> {
    const now = Date.now()
    this.sqlite
      .prepare(
        `
        INSERT INTO partner (
          id, name, avatar_shape, avatar_color, created_at, updated_at, last_viewed_at, pinned, pinned_at
        )
        VALUES (@id, @name, @avatar_shape, @avatar_color, @created_at, @updated_at, @last_viewed_at, @pinned, @pinned_at)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          avatar_shape = excluded.avatar_shape,
          avatar_color = excluded.avatar_color,
          updated_at = excluded.updated_at
      `
      )
      .run({
        id: partner.id,
        name: partner.name,
        avatar_shape: partner.avatar_shape,
        avatar_color: partner.avatar_color,
        created_at: partner.created_at,
        updated_at: now,
        last_viewed_at: partner.last_viewed_at || partner.created_at,
        pinned: toSqliteBoolean(partner.pinned),
        pinned_at: partner.pinned_at
      })
  }

  public async setPartnerPinned(partnerId: string, pinned: boolean): Promise<void> {
    const pinnedAt = pinned ? Date.now() : null
    const result = this.sqlite
      .prepare('UPDATE partner SET pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?')
      .run(toSqliteBoolean(pinned), pinnedAt, Date.now(), partnerId)
    if (result.changes === 0) {
      throw new Error('partner not found')
    }
  }

  public async markPartnerViewed(partnerId: string, viewedAt = Date.now()): Promise<void> {
    this.sqlite
      .prepare('UPDATE partner SET last_viewed_at = ?, updated_at = ? WHERE id = ?')
      .run(viewedAt, viewedAt, partnerId)
  }

  public async listUnreadCompletedPartnerIds(): Promise<string[]> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT DISTINCT partner.id
        FROM partner
        INNER JOIN ai_run AS run ON run.partner_id = partner.id
        WHERE run.status = 'completed'
          AND run.finished_at IS NOT NULL
          AND run.finished_at > partner.last_viewed_at
      `
      )
      .all() as Array<{ id?: unknown }>
    return rows.map((row) => toRequiredString(row.id)).filter(Boolean)
  }

  public async getPartner(id: string): Promise<Partner | null> {
    const row = this.sqlite
      .prepare(`SELECT ${PARTNER_SELECT_COLUMNS} FROM partner WHERE id = ?`)
      .get(id) as PartnerRow | undefined
    return row ? toPartner(row) : null
  }

  public async listPartners(): Promise<Partner[]> {
    const rows = this.sqlite
      .prepare(
        `SELECT ${PARTNER_SELECT_COLUMNS} FROM partner
         ORDER BY pinned DESC, pinned_at DESC, updated_at DESC, created_at DESC`
      )
      .all() as PartnerRow[]
    return rows.map(toPartner)
  }

  public async deletePartner(id: string): Promise<void> {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM browser_tab_state WHERE owner_key = ?').run(id)
      this.sqlite
        .prepare(
          `UPDATE workbench_ui_state
           SET active_view_key = NULL, updated_at = ?
           WHERE id = 1 AND active_view_key = ?`
        )
        .run(Date.now(), id)
      this.sqlite.prepare('DELETE FROM partner WHERE id = ?').run(id)
    })
  }
}

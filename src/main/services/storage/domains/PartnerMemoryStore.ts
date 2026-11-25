import {
  PARTNER_MEMORY_CATEGORIES,
  PARTNER_MEMORY_LIMITS,
  type PartnerMemory,
  type PartnerMemoryCategory,
  type PartnerMemoryEnabled,
  type PartnerMemorySnapshot,
  type PartnerMemoryUpdateRequest,
  type PartnerMemoryUpdateResult
} from '../../../../shared/partnerMemory'
import { applyUniqueTextEdits, type TextEdit } from '../../../utils/textEdits'
import type { SqliteCore } from '../sqlite/SqliteCore'

type MemoryRow = Omit<PartnerMemory, 'enabled'> & { enabled: number }
export type MemoryChange =
  | { action: 'append'; content: string }
  | { action: 'edit'; edits: TextEdit[] }

export class PartnerMemoryStore {
  public onChanged?: (snapshot: PartnerMemorySnapshot) => void

  public constructor(private readonly sqlite: SqliteCore) {}

  public ensure(partnerId: string): void {
    if (!this.sqlite.prepare('SELECT id FROM partner WHERE id = ?').get(partnerId))
      throw new Error('Partner not found')
    const insert = this.sqlite.prepare(
      'INSERT OR IGNORE INTO partner_memory (partner_id, category) VALUES (?, ?)'
    )
    PARTNER_MEMORY_CATEGORIES.forEach((category) => insert.run(partnerId, category))
  }

  public get(partnerId: string): PartnerMemorySnapshot {
    const query = this.sqlite.prepare(
      'SELECT category, enabled, confirmed, draft, revision FROM partner_memory WHERE partner_id = ? ORDER BY category'
    )
    let rows = query.all(partnerId) as MemoryRow[]
    if (rows.length !== PARTNER_MEMORY_CATEGORIES.length) {
      this.sqlite.transaction(() => this.ensure(partnerId))
      rows = query.all(partnerId) as MemoryRow[]
    }
    return { partnerId, memories: rows.map((row) => ({ ...row, enabled: row.enabled === 1 })) }
  }

  public setEnabled(partnerId: string, enabled: PartnerMemoryEnabled): void {
    this.sqlite.transaction(() => {
      this.ensure(partnerId)
      const update = this.sqlite.prepare(
        'UPDATE partner_memory SET enabled = ?, revision = revision + 1 WHERE partner_id = ? AND category = ? AND enabled != ?'
      )
      PARTNER_MEMORY_CATEGORIES.forEach((category) =>
        update.run(Number(enabled[category]), partnerId, category, Number(enabled[category]))
      )
    })
  }

  public notify(partnerId: string): void {
    this.onChanged?.(this.get(partnerId))
  }

  public propose(partnerId: string, category: PartnerMemoryCategory, change: MemoryChange): void {
    this.sqlite.transaction(() => {
      const memory = this.getCategory(partnerId, category)
      if (!memory.enabled) throw new Error('This memory category is disabled')
      const current = memory.draft ?? memory.confirmed
      const next =
        change.action === 'append'
          ? [current, change.content.replace(/\r\n?/g, '\n')].filter(Boolean).join('\n')
          : applyUniqueTextEdits(current, change.edits, 'the latest memory')
      if (next === current) throw new Error('The change is empty')
      this.write(partnerId, memory, memory.confirmed, next)
    })
    this.notify(partnerId)
  }

  public update(request: PartnerMemoryUpdateRequest): PartnerMemoryUpdateResult {
    const status = this.sqlite.transaction(() => {
      const memory = this.getCategory(request.partnerId, request.category)
      if (request.revision !== memory.revision) return 'conflict' as const
      if (request.action === 'write') {
        if (typeof request.content !== 'string') throw new Error('content is required')
        const content = request.content.replace(/\r\n?/g, '\n')
        this.write(
          request.partnerId,
          memory,
          memory.draft === null ? content : memory.confirmed,
          memory.draft === null ? null : content
        )
      } else if (request.action === 'accept') {
        if (memory.draft === null) throw new Error('No pending memory change')
        this.write(request.partnerId, memory, memory.draft, null)
      } else if (request.action === 'reject') {
        this.write(request.partnerId, memory, memory.confirmed, null)
      } else throw new Error('Invalid memory action')
      return 'saved' as const
    })
    const snapshot = this.get(request.partnerId)
    if (status === 'saved') this.onChanged?.(snapshot)
    return { status, snapshot }
  }

  private getCategory(partnerId: string, category: PartnerMemoryCategory): PartnerMemory {
    const memory = this.get(partnerId).memories.find((item) => item.category === category)
    if (!memory) throw new Error('Invalid memory category')
    return memory
  }

  private write(
    partnerId: string,
    memory: PartnerMemory,
    confirmed: string,
    draft: string | null
  ): void {
    const limit = PARTNER_MEMORY_LIMITS[memory.category]
    if ([...confirmed].length > limit || (draft !== null && [...draft].length > limit))
      throw new Error(`Memory exceeds the ${limit} character limit`)
    const normalizedDraft = draft === confirmed ? null : draft
    if (confirmed === memory.confirmed && normalizedDraft === memory.draft) return
    this.sqlite
      .prepare(
        'UPDATE partner_memory SET confirmed = ?, draft = ?, revision = revision + 1 WHERE partner_id = ? AND category = ?'
      )
      .run(confirmed, normalizedDraft, partnerId, memory.category)
  }
}

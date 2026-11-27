import { randomUUID } from 'node:crypto'
import type { SqliteCore } from '../sqlite/SqliteCore'
import type { SkillIdentity } from '../../../../shared/userSkills'

type IdentityRow = {
  id: string
  name: string
  official_id: string | null
  display_name: string | null
  version: string | null
  baseline_sha256: string | null
}
const identity = (row: IdentityRow): SkillIdentity => ({
  id: row.id,
  name: row.name,
  ...(row.official_id ? { officialId: row.official_id } : {}),
  ...(row.display_name ? { displayName: row.display_name } : {}),
  ...(row.version ? { version: row.version } : {}),
  ...(row.baseline_sha256 ? { baselineSha256: row.baseline_sha256 } : {})
})

/** Only identity, installation receipts and partner choices; bodies remain on disk. */
export class PartnerSkillStore {
  constructor(private readonly sqlite: SqliteCore) {}
  transaction<T>(operation: () => T): T {
    return this.sqlite.transaction(operation)
  }
  partnerName(id: string): string {
    const row = this.sqlite.prepare('SELECT name FROM partner WHERE id=?').get(id) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Partner not found')
    return row.name
  }
  getIdentity(name: string): SkillIdentity | undefined {
    const row = this.sqlite.prepare('SELECT * FROM skill_identity WHERE name=?').get(name) as
      | IdentityRow
      | undefined
    return row ? identity(row) : undefined
  }
  officialIdentity(id: string): SkillIdentity | undefined {
    const row = this.sqlite.prepare('SELECT * FROM skill_identity WHERE official_id=?').get(id) as
      | IdentityRow
      | undefined
    return row ? identity(row) : undefined
  }
  ensureIdentity(name: string): SkillIdentity {
    this.sqlite
      .prepare('INSERT OR IGNORE INTO skill_identity(id,name) VALUES (?,?)')
      .run(`local:${randomUUID()}`, name)
    return this.getIdentity(name)!
  }
  installOfficial(
    meta: {
      id: string
      name: string
      displayName: string
      version: string
      baselineSha256: string
    },
    previousName?: string
  ): void {
    const current = this.officialIdentity(meta.id)
    const collision = this.getIdentity(meta.name)
    if (collision && collision.id !== current?.id)
      throw new Error('Skill name conflicts with a different identity')
    if (previousName && (!current || current.name !== previousName))
      throw new Error('Official skill identity changed during update')
    this.sqlite
      .prepare(
        `INSERT INTO skill_identity(id,name,official_id,display_name,version,baseline_sha256) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_name=excluded.display_name,version=excluded.version,baseline_sha256=excluded.baseline_sha256`
      )
      .run(
        `official:${meta.id}`,
        meta.name,
        meta.id,
        meta.displayName,
        meta.version,
        meta.baselineSha256
      )
  }
  listBoundPartners(name: string): { id: string; name: string }[] {
    return this.sqlite
      .prepare(
        `SELECT p.id,p.name FROM partner p JOIN partner_user_skill b ON b.partner_id=p.id
      JOIN skill_identity s ON s.id=b.skill_id WHERE s.name=? ORDER BY p.name,p.id`
      )
      .all(name) as { id: string; name: string }[]
  }
  listEnabled(partnerId: string): string[] {
    return (
      this.sqlite
        .prepare(
          `SELECT s.name FROM skill_identity s JOIN partner_user_skill b ON b.skill_id=s.id
      WHERE b.partner_id=? ORDER BY s.name`
        )
        .all(partnerId) as { name: string }[]
    ).map((row) => row.name)
  }
  setEnabled(partnerId: string, names: string[]): void {
    this.partnerName(partnerId)
    this.transaction(() => {
      const ids = [...new Set(names)].sort().map((name) => this.ensureIdentity(name).id)
      this.sqlite.prepare('DELETE FROM partner_user_skill WHERE partner_id=?').run(partnerId)
      const insert = this.sqlite.prepare(
        'INSERT INTO partner_user_skill(partner_id,skill_id) VALUES (?,?)'
      )
      ids.forEach((id) => insert.run(partnerId, id))
    })
  }
  rename(previousName: string, name: string): void {
    if (previousName === name) return
    this.ensureIdentity(previousName)
    if (this.getIdentity(name)) throw new Error('Skill identity name conflict')
    this.sqlite.prepare('UPDATE skill_identity SET name=? WHERE name=?').run(name, previousName)
  }
  delete(name: string): void {
    this.sqlite
      .prepare(
        'DELETE FROM partner_user_skill WHERE skill_id IN (SELECT id FROM skill_identity WHERE name=?)'
      )
      .run(name)
    this.sqlite.prepare('DELETE FROM skill_identity WHERE name=?').run(name)
  }
}

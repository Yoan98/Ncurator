import type { SqliteCore } from '../sqlite/SqliteCore'

/** Only partner choices are persisted; Skill contents and metadata live in directories. */
export class PartnerSkillStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public transaction<T>(operation: () => T): T {
    return this.sqlite.transaction(operation)
  }

  public partnerName(id: string): string {
    const row = this.sqlite.prepare('SELECT name FROM partner WHERE id = ?').get(id) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Partner not found')
    return row.name
  }

  public listBoundPartners(name: string): Array<{ id: string; name: string }> {
    return this.sqlite
      .prepare(
        'SELECT p.id, p.name FROM partner p JOIN partner_user_skill b ON b.partner_id = p.id WHERE b.skill_name = ? ORDER BY p.name, p.id'
      )
      .all(name) as Array<{ id: string; name: string }>
  }

  public listEnabled(partnerId: string): string[] {
    return (
      this.sqlite
        .prepare(
          'SELECT skill_name FROM partner_user_skill WHERE partner_id = ? ORDER BY skill_name'
        )
        .all(partnerId) as Array<{ skill_name: string }>
    ).map((row) => row.skill_name)
  }

  public setEnabled(partnerId: string, names: string[]): void {
    this.partnerName(partnerId)
    const unique = [...new Set(names)].sort()
    this.transaction(() => {
      this.sqlite.prepare('DELETE FROM partner_user_skill WHERE partner_id = ?').run(partnerId)
      const insert = this.sqlite.prepare(
        'INSERT INTO partner_user_skill (partner_id, skill_name) VALUES (?, ?)'
      )
      unique.forEach((name) => insert.run(partnerId, name))
    })
  }

  public rename(previousName: string, name: string): void {
    if (previousName === name) return
    this.sqlite
      .prepare(
        'INSERT OR IGNORE INTO partner_user_skill (partner_id, skill_name) SELECT partner_id, ? FROM partner_user_skill WHERE skill_name = ?'
      )
      .run(name, previousName)
    this.delete(previousName)
  }

  public delete(name: string): void {
    this.sqlite.prepare('DELETE FROM partner_user_skill WHERE skill_name = ?').run(name)
  }
}

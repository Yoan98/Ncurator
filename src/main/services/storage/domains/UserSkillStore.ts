import type { UserSkill } from '../../../../shared/userSkills'
import type { SqliteCore } from '../sqlite/SqliteCore'

type SkillRow = {
  id: string
  name: string
  description: string
  directory_name: string
  created_at: number
}
const toSkill = (row: SkillRow): UserSkill => ({
  id: row.id,
  name: row.name,
  description: row.description,
  directoryName: row.directory_name,
  createdAt: row.created_at
})

export class UserSkillStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public list(): UserSkill[] {
    return (
      this.sqlite.prepare('SELECT * FROM user_skill ORDER BY name, id').all() as SkillRow[]
    ).map(toSkill)
  }

  public get(id: string): UserSkill | undefined {
    const row = this.sqlite.prepare('SELECT * FROM user_skill WHERE id = ?').get(id) as
      | SkillRow
      | undefined
    return row ? toSkill(row) : undefined
  }

  public insert(skill: UserSkill): void {
    this.sqlite
      .prepare(
        `INSERT INTO user_skill (id, name, description, directory_name, created_at)
      VALUES (?, ?, ?, ?, ?)`
      )
      .run(skill.id, skill.name, skill.description, skill.directoryName, skill.createdAt)
  }

  public delete(id: string): void {
    this.sqlite.prepare('DELETE FROM user_skill WHERE id = ?').run(id)
  }

  public listEnabled(partnerId: string): UserSkill[] {
    return (
      this.sqlite
        .prepare(
          `SELECT s.* FROM user_skill s
      JOIN partner_user_skill b ON b.skill_id = s.id WHERE b.partner_id = ?
      ORDER BY s.name, s.id`
        )
        .all(partnerId) as SkillRow[]
    ).map(toSkill)
  }

  public setEnabled(partnerId: string, skillIds: string[]): void {
    if (!this.sqlite.prepare('SELECT id FROM partner WHERE id = ?').get(partnerId)) {
      throw new Error('Partner not found')
    }
    const ids = [...new Set(skillIds)].sort()
    if (ids.some((id) => !this.get(id))) throw new Error('Skill not found')
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM partner_user_skill WHERE partner_id = ?').run(partnerId)
      const insert = this.sqlite.prepare(
        'INSERT INTO partner_user_skill (partner_id, skill_id) VALUES (?, ?)'
      )
      ids.forEach((id) => insert.run(partnerId, id))
    })
  }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { UserSkillStore } from '../../../../src/main/services/storage/domains/UserSkillStore'
import {
  UserSkillService,
  parseSkillMarkdown
} from '../../../../src/main/services/skills/UserSkillService'

const markdown = (name = 'example', body = 'Read references/guide.md first.') =>
  `---\nname: ${name}\ndescription: A reusable workflow\nlicense: MIT\nmetadata:\n  custom: keep-me\n---\n${body}\n`
let root: string
let db: SqliteCore
let store: UserSkillStore
let service: UserSkillService
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-skills-'))
  db = new SqliteCore(path.join(root, 'app.sqlite'))
  db.initialize()
  for (const id of ['alice', 'bob']) {
    db.prepare(
      `INSERT INTO partner (id, name, avatar_shape, avatar_color, created_at, updated_at, last_viewed_at)
      VALUES (?, ?, 'circle', 'brown', 1, 1, 1)`
    ).run(id, id)
  }
  store = new UserSkillStore(db)
  service = new UserSkillService(store, path.join(root, 'skills'))
})
afterEach(() => {
  db?.close()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('shared user Skill files and partner bindings', () => {
  it('creates a standard Skill, stores metadata only, and requires a partner binding', () => {
    const skill = service.create(markdown())
    expect(skill.id).toMatch(/^user:/)
    expect(service.listEnabled('alice')).toEqual([])
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/not enabled/)
    service.setEnabled('alice', [skill.id, skill.id])
    expect(service.listEnabled('alice')).toEqual([skill])
    expect(service.listEnabled('bob')).toEqual([])
    expect(() => service.loadEnabled('bob', skill.id)).toThrow(/not enabled/)
    const loaded = service.loadEnabled('alice', skill.id)
    expect(loaded.body).toContain('references/guide.md')
    expect(loaded.resourceBase).toBe(path.join(root, 'skills', 'example'))
    expect(fs.readFileSync(path.join(loaded.resourceBase, 'SKILL.md'), 'utf8')).toBe(markdown())
    const columns = db.prepare('PRAGMA table_info(user_skill)').all() as { name: string }[]
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'description',
      'directory_name',
      'created_at'
    ])
  })

  it('copies all resource types and preserves bytes and unknown frontmatter after the source disappears', () => {
    const source = path.join(root, 'workbuddy-installed-skill')
    fs.mkdirSync(path.join(source, 'references'), { recursive: true })
    fs.mkdirSync(path.join(source, 'scripts'))
    fs.mkdirSync(path.join(source, 'assets'))
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(source, 'scripts', 'run.py'), 'raise Exception("MUST NOT RUN")')
    fs.writeFileSync(path.join(source, 'references', 'guide.md'), 'Guide')
    const binary = Buffer.from([0, 255, 12, 0])
    fs.writeFileSync(path.join(source, 'assets', 'sample.bin'), binary)
    fs.writeFileSync(path.join(source, 'custom-resource.data'), 'custom')
    const skill = service.importFolder(source)
    fs.rmSync(source, { recursive: true })
    service.setEnabled('alice', [skill.id])
    const { resourceBase } = service.loadEnabled('alice', skill.id)
    expect(fs.readFileSync(path.join(resourceBase, 'SKILL.md'), 'utf8')).toBe(markdown())
    expect(fs.readFileSync(path.join(resourceBase, 'assets', 'sample.bin'))).toEqual(binary)
    expect(fs.readFileSync(path.join(resourceBase, 'custom-resource.data'), 'utf8')).toBe('custom')
    expect(fs.readFileSync(path.join(resourceBase, 'scripts', 'run.py'), 'utf8')).toContain(
      'MUST NOT RUN'
    )
  })

  it('persists bindings across reopening and disables only the selected partner', () => {
    const skill = service.create(markdown())
    service.setEnabled('alice', [skill.id])
    service.setEnabled('bob', [skill.id])
    db.close()
    db = new SqliteCore(path.join(root, 'app.sqlite'))
    db.initialize()
    store = new UserSkillStore(db)
    service = new UserSkillService(store, path.join(root, 'skills'))
    expect(service.loadEnabled('alice', skill.id).skill.id).toBe(skill.id)
    service.setEnabled('alice', [])
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/not enabled/)
    expect(service.loadEnabled('bob', skill.id).skill.id).toBe(skill.id)
    expect(() => service.setEnabled('bob', ['missing'])).toThrow(/not found/)
    expect(service.listEnabled('bob')).toEqual([skill])
  })

  it('can disable broken assets independently without validating retained broken files', () => {
    const a = service.create(markdown('alpha'))
    const b = service.create(markdown('beta'))
    service.setEnabled('alice', [a.id, b.id])
    fs.rmSync(path.join(root, 'skills', 'alpha', 'SKILL.md'))
    fs.rmSync(path.join(root, 'skills', 'beta', 'SKILL.md'))
    service.setEnabled('alice', [b.id])
    expect(service.listEnabled('alice')).toEqual([b])
    service.setEnabled('alice', [])
    expect(service.listEnabled('alice')).toEqual([])
  })

  it('rejects duplicate names atomically and leaves prior content and bindings intact', () => {
    const original = service.create(markdown())
    service.setEnabled('alice', [original.id])
    expect(() => service.create(markdown('example', 'Replacement'))).toThrow(/already exists/)
    expect(service.loadEnabled('alice', original.id).body).not.toContain('Replacement')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('cascades binding removal but not shared assets when a partner is deleted', () => {
    const skill = service.create(markdown())
    service.setEnabled('alice', [skill.id])
    service.setEnabled('bob', [skill.id])
    db.prepare('DELETE FROM partner WHERE id = ?').run('alice')
    expect(service.listEnabled('alice')).toEqual([])
    expect(service.loadEnabled('bob', skill.id).body).toContain('guide')
    service.delete(skill.id)
    expect(service.listEnabled('bob')).toEqual([])
    expect(service.list()).toEqual([])
    expect(fs.existsSync(path.join(root, 'skills', 'example'))).toBe(false)
  })

  it('rejects symlinked resources without copying files outside the selected folder', () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(root, 'outside'), 'private')
    fs.symlinkSync(path.join(root, 'outside'), path.join(source, 'escape'))
    expect(() => service.importFolder(source)).toThrow(/symbolic links/i)
    expect(service.list()).toEqual([])
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual([])
    fs.symlinkSync(source, path.join(root, 'source-link'))
    expect(() => service.importFolder(path.join(root, 'source-link'))).toThrow(/symbolic link/)
  })

  it('rejects oversized files and excessive directory entries with complete staging cleanup', () => {
    const source = path.join(root, 'large-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const oversized = path.join(source, 'oversized.bin')
    fs.writeFileSync(oversized, '')
    fs.truncateSync(oversized, 16 * 1024 * 1024 + 1)
    expect(() => service.importFolder(source)).toThrow(/size limit/)
    fs.rmSync(oversized)
    for (let i = 0; i < 1000; i++) fs.writeFileSync(path.join(source, `resource-${i}`), '')
    expect(() => service.importFolder(source)).toThrow(/1000/)
    expect(service.list()).toEqual([])
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual([])
    expect(() => service.importFolder(root)).toThrow(/containing managed/)
  })

  it('rejects a replaced SKILL.md symlink on each load and never reads its target', () => {
    const skill = service.create(markdown())
    service.setEnabled('alice', [skill.id])
    const skillFile = path.join(root, 'skills', 'example', 'SKILL.md')
    fs.rmSync(skillFile)
    const external = path.join(root, 'external.md')
    fs.writeFileSync(external, markdown('example', 'PRIVATE'))
    fs.symlinkSync(external, skillFile)
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/symbolic links/)
    expect(fs.readFileSync(external, 'utf8')).toContain('PRIVATE')
  })

  it('rejects tampered managed paths and metadata on each runtime load', () => {
    const skill = service.create(markdown())
    service.setEnabled('alice', [skill.id])
    fs.writeFileSync(path.join(root, 'skills', 'example', 'SKILL.md'), markdown('renamed'))
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/metadata changed/)
    db.prepare('UPDATE user_skill SET directory_name = ? WHERE id = ?').run('../outside', skill.id)
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/Invalid stored/)
  })

  it('removes broken metadata entries even when their asset directory was deleted externally', () => {
    const skill = service.create(markdown())
    fs.rmSync(path.join(root, 'skills', 'example'), { recursive: true })
    service.delete(skill.id)
    expect(service.list()).toEqual([])
  })

  it('sorts catalogs deterministically independently of import/binding order', () => {
    const z = service.create(markdown('zebra'))
    const a = service.create(markdown('alpha'))
    service.setEnabled('alice', [z.id, a.id])
    service.setEnabled('bob', [a.id, z.id])
    expect(service.listEnabled('alice').map((item) => item.name)).toEqual(['alpha', 'zebra'])
    expect(service.listEnabled('alice')).toEqual(service.listEnabled('bob'))
  })

  it.each(['../escape', 'Uppercase', 'two--hyphens', 'con', 'a'.repeat(65)])(
    'rejects unsafe or nonstandard names: %s',
    (name) => {
      expect(() => service.create(markdown(name))).toThrow(/Skill name/)
    }
  )

  it('accepts multiline YAML descriptions and does not execute or resolve YAML tags', () => {
    const parsed = parseSkillMarkdown(
      '---\nname: example\ndescription: |\n  First line\n  Second line\ncustom: !unrecognized value\n---\nInstructions'
    )
    expect(parsed.description).toBe('First line\nSecond line')
    expect(() =>
      parseSkillMarkdown('---\nname: example\nname: duplicate\ndescription: Test\n---\nBody')
    ).toThrow(/Invalid/)
    expect(() => service.create(markdown('large', 'x'.repeat(33 * 1024)))).toThrow(/32 KiB/)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { UserSkillStore } from '../../../../src/main/services/storage/domains/UserSkillStore'
import {
  UserSkillService,
  parseSkillMarkdown
} from '../../../../src/main/services/skills/UserSkillService'

const importSkill = (source: string) =>
  service.commitImport({ token: service.prepareImport(source).token, replaceExisting: false })

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
    const skill = service.create(parseSkillMarkdown(markdown()))
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
    expect(
      parseSkillMarkdown(fs.readFileSync(path.join(loaded.resourceBase, 'SKILL.md'), 'utf8'))
    ).toMatchObject({ name: 'example', description: 'A reusable workflow' })
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
    const skill = importSkill(source)
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
    const skill = service.create(parseSkillMarkdown(markdown()))
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
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    const b = service.create(parseSkillMarkdown(markdown('beta')))
    service.setEnabled('alice', [a.id, b.id])
    fs.rmSync(path.join(root, 'skills', 'alpha', 'SKILL.md'))
    fs.rmSync(path.join(root, 'skills', 'beta', 'SKILL.md'))
    service.setEnabled('alice', [b.id])
    expect(service.listEnabled('alice')).toEqual([b])
    service.setEnabled('alice', [])
    expect(service.listEnabled('alice')).toEqual([])
  })

  it('rejects duplicate names atomically and leaves prior content and bindings intact', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [original.id])
    expect(() => service.create(parseSkillMarkdown(markdown('example', 'Replacement')))).toThrow(
      /already exists/
    )
    expect(service.loadEnabled('alice', original.id).body).not.toContain('Replacement')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('cascades binding removal but not shared assets when a partner is deleted', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
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
    expect(() => importSkill(source)).toThrow(/symbolic links/i)
    expect(service.list()).toEqual([])
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual([])
    fs.symlinkSync(source, path.join(root, 'source-link'))
    expect(() => importSkill(path.join(root, 'source-link'))).toThrow(/symbolic link/)
  })

  it('rejects oversized files and excessive directory entries with complete staging cleanup', () => {
    const source = path.join(root, 'large-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const oversized = path.join(source, 'oversized.bin')
    fs.writeFileSync(oversized, '')
    fs.truncateSync(oversized, 16 * 1024 * 1024 + 1)
    expect(() => importSkill(source)).toThrow(/size limit/)
    fs.rmSync(oversized)
    for (let i = 0; i < 1000; i++) fs.writeFileSync(path.join(source, `resource-${i}`), '')
    expect(() => importSkill(source)).toThrow(/1000/)
    expect(service.list()).toEqual([])
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual([])
    expect(() => importSkill(root)).toThrow(/containing managed/)
  })

  it('rejects a replaced SKILL.md symlink on each load and never reads its target', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
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
    const skill = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [skill.id])
    fs.writeFileSync(path.join(root, 'skills', 'example', 'SKILL.md'), markdown('renamed'))
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/metadata changed/)
    db.prepare('UPDATE user_skill SET directory_name = ? WHERE id = ?').run('../outside', skill.id)
    expect(() => service.loadEnabled('alice', skill.id)).toThrow(/Invalid stored/)
  })

  it('removes broken metadata entries even when their asset directory was deleted externally', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    fs.rmSync(path.join(root, 'skills', 'example'), { recursive: true })
    service.delete(skill.id)
    expect(service.list()).toEqual([])
  })

  it('sorts catalogs deterministically independently of import/binding order', () => {
    const z = service.create(parseSkillMarkdown(markdown('zebra')))
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    service.setEnabled('alice', [z.id, a.id])
    service.setEnabled('bob', [a.id, z.id])
    expect(service.listEnabled('alice').map((item) => item.name)).toEqual(['alpha', 'zebra'])
    expect(service.listEnabled('alice')).toEqual(service.listEnabled('bob'))
  })

  it.each(['../escape', 'Uppercase', 'two--hyphens', 'con', 'a'.repeat(65)])(
    'rejects unsafe or nonstandard names: %s',
    (name) => {
      expect(() => service.create(parseSkillMarkdown(markdown(name)))).toThrow(/Skill name/)
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
    expect(() =>
      service.create(parseSkillMarkdown(markdown('large', 'x'.repeat(33 * 1024))))
    ).toThrow(/32 KiB/)
  })

  it('edits and renames imported files while preserving identity, bindings, unknown YAML and resources', () => {
    const source = path.join(root, 'editable-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(source, 'resource.bin'), Buffer.from([0, 255, 10]))
    const original = importSkill(source)
    service.setEnabled('alice', [original.id])
    service.setEnabled('bob', [original.id])
    const edited = service.update({
      ...service.getDocument(original.id),
      name: 'renamed',
      description: 'Updated description',
      body: '# Updated\nUse the new rules.'
    })
    expect(edited.id).toBe(original.id)
    expect(service.listEnabled('alice')[0].id).toBe(original.id)
    expect(service.listEnabled('bob')[0].id).toBe(original.id)
    const file = fs.readFileSync(path.join(root, 'skills', 'renamed', 'SKILL.md'), 'utf8')
    expect(file).toContain('keep-me')
    expect(file).toContain('MIT')
    expect(file).toContain('Updated description')
    expect(fs.readFileSync(path.join(root, 'skills', 'renamed', 'resource.bin'))).toEqual(
      Buffer.from([0, 255, 10])
    )
    expect(fs.existsSync(path.join(root, 'skills', 'example'))).toBe(false)
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe(markdown())
  })

  it('stages imports, isolates owners, cancels and replaces without losing bindings', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [original.id])
    const source = path.join(root, 'replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('example', 'Replacement body'))
    const cancelled = service.prepareImport(source, 7)
    expect(cancelled.conflict?.id).toBe(original.id)
    expect(() =>
      service.commitImport({ token: cancelled.token, replaceExisting: true }, 8)
    ).toThrow(/expired/)
    service.cancelImport(cancelled.token, 8)
    service.cancelImport(cancelled.token, 7)
    expect(service.loadEnabled('alice', original.id).body).not.toContain('Replacement')
    const next = service.prepareImport(source, 7)
    expect(() => service.commitImport({ token: next.token, replaceExisting: false }, 7)).toThrow(
      /Confirm/
    )
    expect(service.commitImport({ token: next.token, replaceExisting: true }, 7).id).toBe(
      original.id
    )
    expect(service.loadEnabled('alice', original.id).body).toContain('Replacement body')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('rolls back files and metadata when SQLite rejects an edit or replacement', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [original.id])
    db.exec(
      "CREATE TRIGGER reject_skill_update BEFORE UPDATE ON user_skill BEGIN SELECT RAISE(ABORT, 'forced update failure'); END;"
    )
    expect(() =>
      service.update({ ...service.getDocument(original.id), name: 'renamed', body: 'New body' })
    ).toThrow(/forced update failure/)
    expect(service.loadEnabled('alice', original.id).body).toContain('guide')
    expect(service.getDocument(original.id).name).toBe('example')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
    const source = path.join(root, 'replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('example', 'Replacement body'))
    const pending = service.prepareImport(source)
    expect(() => service.commitImport({ token: pending.token, replaceExisting: true })).toThrow(
      /forced update failure/
    )
    expect(service.loadEnabled('alice', original.id).body).toContain('guide')
    expect(service.getDocument(original.id).id).toBe(original.id)
    service.cancelImport(pending.token)
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('checks exact aggregate budgets and every bound partner before edits and replacements', () => {
    const create = (name: string, bytes: number) =>
      service.create({ name, description: 'Budget', body: 'x'.repeat(bytes) })
    const a = create('alpha', 28 * 1024),
      b = create('beta', 28 * 1024),
      c = create('small', 8 * 1024),
      extra = create('extra', 1)
    service.setEnabled('alice', [a.id, b.id, c.id])
    service.setEnabled('bob', [a.id, b.id, c.id])
    expect(service.getSelection('alice').bodyBytes).toBe(64 * 1024)
    expect(() => service.setEnabled('alice', [a.id, b.id, c.id, extra.id])).toThrow(/64 KiB/)
    expect(service.getSelection('alice').skillIds).not.toContain(extra.id)
    expect(() => service.setEnabled('alice', [a.id, b.id, c.id])).not.toThrow()
    expect(() =>
      service.update({ ...service.getDocument(a.id), body: 'y'.repeat(29 * 1024) })
    ).toThrow(/alice、bob/)
    const source = path.join(root, 'budget-replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('alpha', 'z'.repeat(29 * 1024)))
    const pending = service.prepareImport(source)
    expect(() => service.commitImport({ token: pending.token, replaceExisting: true })).toThrow(
      /alice、bob/
    )
    service.cancelImport(pending.token)
    expect(service.getDocument(a.id).body).toBe('x'.repeat(28 * 1024))
    service.setEnabled('alice', [a.id])
    expect(service.getSelection('alice').bodyBytes).toBe(28 * 1024)
  })

  it('counts UTF-8 bytes and revalidates unchanged selections after external edits', () => {
    const make = (name: string) =>
      service.create({ name, description: 'Budget', body: '规'.repeat(9000) })
    const a = make('alpha'),
      b = make('beta'),
      c = service.create({ name: 'small', description: 'Budget', body: 'x'.repeat(8 * 1024) })
    service.setEnabled('alice', [a.id, b.id, c.id])
    expect(service.getSelection('alice').bodyBytes).toBe(54_000 + 8 * 1024)
    for (const skill of [a, b])
      fs.writeFileSync(
        path.join(root, 'skills', skill.name, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: Budget\n---\n${'规'.repeat(10000)}`
      )
    expect(() => service.setEnabled('alice', [a.id, b.id, c.id])).toThrow(/64 KiB/)
    // A strict removal can release configuration even when a retained asset is unreadable.
    fs.unlinkSync(path.join(root, 'skills', a.name, 'SKILL.md'))
    expect(() => service.setEnabled('alice', [a.id, b.id])).not.toThrow()
    expect(service.getSelection('alice').unavailableSkillNames).toEqual(['alpha'])
  })

  it('rejects rename collisions without changing either skill', () => {
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    service.create(parseSkillMarkdown(markdown('beta')))
    expect(() => service.update({ ...service.getDocument(a.id), name: 'beta' })).toThrow(
      /already exists/
    )
    expect(service.getDocument(a.id).name).toBe('alpha')
  })

  it.skipIf(process.platform === 'win32')(
    'preserves executable and non-executable modes without executing imported scripts',
    () => {
      const source = path.join(root, 'permission-source')
      fs.mkdirSync(source)
      fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
      const marker = path.join(root, 'ran')
      fs.writeFileSync(
        path.join(source, 'run.sh'),
        '#!/bin/sh\nprintf ok > "$NCURATOR_SKILL_MARKER"\n',
        { mode: 0o755 }
      )
      fs.chmodSync(path.join(source, 'run.sh'), 0o4755)
      fs.writeFileSync(path.join(source, 'data.txt'), 'data', { mode: 0o644 })
      const skill = importSkill(source)
      const target = path.join(root, 'skills', skill.name)
      expect(fs.existsSync(marker)).toBe(false)
      expect(fs.statSync(path.join(target, 'run.sh')).mode & 0o7777).toBe(0o755)
      expect(fs.statSync(path.join(target, 'data.txt')).mode & 0o777).toBe(0o644)
      const output = spawnSync(path.join(target, 'run.sh'), [], {
        env: { ...process.env, NCURATOR_SKILL_MARKER: marker }
      })
      expect(output.status).toBe(0)
      expect(fs.readFileSync(marker, 'utf8')).toBe('ok')
    }
  )
})

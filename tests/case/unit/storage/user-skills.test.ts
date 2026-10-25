import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import { UserSkillStore } from '../../../../src/main/services/storage/domains/UserSkillStore'
import {
  UserSkillService,
  parseSkillMarkdown
} from '../../../../src/main/services/skills/UserSkillService'

const importSkill = (source: string) =>
  service.commitImport({ ...service.prepareImport(source), replaceId: null })

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
  it('publishes complete snapshots and configures only the current partner without executing scripts', async () => {
    const changed = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), changed)
    const source = path.join(root, 'draft')
    fs.mkdirSync(path.join(source, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const script = path.join(source, 'scripts', 'run.sh')
    fs.writeFileSync(script, `#!/bin/sh\ntouch '${path.join(root, 'unexpected-execution')}'\n`, {
      mode: 0o751
    })
    const other = service.create({ name: 'other', description: 'Other', body: 'Keep' })
    service.setEnabled('alice', [other.id])
    const skill = service.editForPartner('alice', { sourcePath: source, enabled: true })
    expect(service.listEnabled('alice').map((item) => item.id)).toEqual(
      expect.arrayContaining([other.id, skill.id])
    )
    expect(service.listEnabled('bob')).toEqual([])
    const detail = service.readForPartner('alice', skill.id)
    expect(detail).toMatchObject({ id: skill.id, enabled: true, content: markdown() })
    expect(fs.existsSync(path.join(root, 'unexpected-execution'))).toBe(false)
    if (process.platform !== 'win32')
      expect(
        fs.statSync(path.join(root, 'skills', 'example', 'scripts', 'run.sh')).mode & 0o777
      ).toBe(0o751)
    service.setEnabled('bob', [skill.id])
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('renamed', 'New body'))
    fs.rmSync(script)
    expect(
      service.editForPartner('alice', { id: skill.id, sourcePath: source, enabled: false })
    ).toEqual({ id: skill.id, name: 'renamed' })
    expect(service.listEnabled('alice').map((item) => item.id)).toEqual([other.id])
    expect(service.listEnabled('bob').map((item) => item.id)).toEqual([skill.id])
    expect(service.getDocument(skill.id).resources).toEqual([])
    expect(service.readForPartner('bob', skill.id)).toMatchObject({
      content: markdown('renamed', 'New body'),
      enabled: true
    })
    expect(() =>
      service.editForPartner('alice', { sourcePath: path.join(root, 'skills', 'renamed') })
    ).toThrow(/managed/)
    fs.rmSync(source, { recursive: true })
    expect(service.getDocument(skill.id).body).toContain('New body')
    await Promise.resolve()
    expect(changed).toHaveBeenCalled()
  })

  it('validates final bindings and rolls back directory, metadata and selection on database failure', async () => {
    const source = path.join(root, 'draft')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('target', 'x'.repeat(40 * 1024)))
    const target = service.editForPartner('alice', { sourcePath: source, enabled: true })
    const other = service.create({
      name: 'other',
      description: 'Other',
      body: 'x'.repeat(20 * 1024)
    })
    service.setEnabled('alice', [target.id, other.id])
    service.setEnabled('bob', [target.id, other.id])
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('target', 'x'.repeat(50 * 1024)))
    expect(() => service.editForPartner('alice', { id: target.id, sourcePath: source })).toThrow(
      /64 KiB/
    )
    expect(() =>
      service.editForPartner('alice', { id: target.id, sourcePath: source, enabled: false })
    ).toThrow(/bob/)
    service.setEnabled('bob', [target.id])
    // The changed body is no longer bound in the final state, so it must be allowed.
    service.editForPartner('alice', { id: target.id, sourcePath: source, enabled: false })
    expect(service.listEnabled('alice').map((item) => item.id)).toEqual([other.id])
    expect(service.listEnabled('bob').map((item) => item.id)).toEqual([target.id])
  })

  it('restores all persistent state and sends no notification when binding persistence fails', async () => {
    const notify = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), notify)
    const source = path.join(root, 'draft')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const original = service.editForPartner('alice', { sourcePath: source })
    await Promise.resolve()
    notify.mockClear()
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('renamed', 'Updated'))
    const write = vi.spyOn(store, 'setEnabled').mockImplementation(() => {
      throw new Error('database failure')
    })
    expect(() =>
      service.editForPartner('alice', { id: original.id, sourcePath: source, enabled: true })
    ).toThrow(/database failure/)
    expect(service.getDocument(original.id)).toMatchObject({
      name: 'example',
      body: expect.stringContaining('Read references')
    })
    expect(service.listEnabled('alice')).toEqual([])
    expect(fs.existsSync(path.join(root, 'skills', 'renamed'))).toBe(false)
    expect(() => service.editForPartner('alice', { sourcePath: source, enabled: true })).toThrow(
      /database failure/
    )
    expect(service.list()).toHaveLength(1)
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
    write.mockRestore()
  })
  it('restores the previous directory and bindings when publishing the new directory fails', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('bob', [original.id])
    const source = path.join(root, 'draft')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('renamed', 'Changed'))
    const rename = fs.renameSync
    const publish = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === path.join(root, 'skills', 'renamed')) throw new Error('publish failure')
      rename(from, to)
    })
    try {
      expect(() =>
        service.editForPartner('alice', {
          id: original.id,
          sourcePath: source,
          enabled: true
        })
      ).toThrow('publish failure')
    } finally {
      publish.mockRestore()
    }
    expect(service.getDocument(original.id).name).toBe('example')
    expect(service.listEnabled('alice')).toEqual([])
    expect(service.listEnabled('bob')).toEqual([original])
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

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
  })

  it('creates and updates long instructions while enforcing only the aggregate partner allowance', () => {
    const long = service.create({
      name: 'long',
      description: 'Long instructions',
      body: 'x'.repeat(40 * 1024)
    })
    const extra = service.create({
      name: 'extra',
      description: 'Remainder',
      body: 'y'.repeat(24 * 1024)
    })
    expect(service.getDocument(long.id).body.length).toBe(40 * 1024)
    service.setEnabled('alice', [long.id, extra.id])
    expect(service.loadEnabled('alice', long.id).body.length).toBe(40 * 1024)
    expect(service.getSelection('alice').bodyBytes).toBe(64 * 1024)
    expect(() =>
      service.update({ ...service.getDocument(long.id), body: 'z'.repeat(41 * 1024) })
    ).toThrow(/alice/)
    expect(service.getDocument(long.id).body).toBe('x'.repeat(40 * 1024))
    service.setEnabled('alice', [long.id])
    service.update({ ...service.getDocument(long.id), body: 'z'.repeat(60 * 1024) })
    expect(service.loadEnabled('alice', long.id).body.length).toBe(60 * 1024)
    const unbound = service.create({
      name: 'unbound',
      description: 'Stored only',
      body: 'w'.repeat(80 * 1024)
    })
    expect(service.getDocument(unbound.id).body.length).toBe(80 * 1024)
    expect(() => service.setEnabled('bob', [unbound.id])).toThrow(/64 KiB/)
    expect(service.getSelection('bob').skillIds).toEqual([])
  })

  it('imports and replaces long instructions and rolls back when bound partners exceed their allowance', () => {
    const source = path.join(root, 'long-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'a'.repeat(40 * 1024)))
    const saved = importSkill(source)
    service.setEnabled('alice', [saved.id])
    service.setEnabled('bob', [saved.id])
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'b'.repeat(60 * 1024)))
    const accepted = service.prepareImport(source)
    expect(service.commitImport({ ...accepted, replaceId: saved.id }).id).toBe(saved.id)
    expect(service.loadEnabled('bob', saved.id).body).toContain('b'.repeat(60 * 1024))
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'c'.repeat(65 * 1024)))
    const rejected = service.prepareImport(source)
    expect(() => service.commitImport({ ...rejected, replaceId: saved.id })).toThrow(/alice、bob/)
    expect(service.loadEnabled('alice', saved.id).body).toContain('b'.repeat(60 * 1024))
    service.cancelImport(rejected.token)
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['long-import'])
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
    expect(() => service.commitImport({ ...cancelled, replaceId: original.id }, 8)).toThrow(
      /expired/
    )
    service.cancelImport(cancelled.token, 8)
    service.cancelImport(cancelled.token, 7)
    expect(service.loadEnabled('alice', original.id).body).not.toContain('Replacement')
    const next = service.prepareImport(source, 7)
    expect(() => service.commitImport({ ...next, replaceId: null }, 7)).toThrow(/already exists/)
    expect(service.commitImport({ ...next, replaceId: original.id }, 7).id).toBe(original.id)
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
    expect(() => service.commitImport({ ...pending, replaceId: original.id })).toThrow(
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
    expect(() => service.commitImport({ ...pending, replaceId: a.id })).toThrow(/alice、bob/)
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
  it('atomically saves partner properties and bindings and rolls them back on budget failure', async () => {
    const partners = new PartnerStore(db)
    const old = (await partners.getPartner('alice'))!
    const skills = ['one', 'two', 'three'].map((name) =>
      service.create({ name, description: 'Budget', body: 'x'.repeat(24 * 1024) })
    )
    db.transaction(() => {
      partners.savePartner({ ...old, name: 'configured' })
      service.setEnabled(old.id, [skills[0].id])
    })
    expect((await partners.getPartner(old.id))?.name).toBe('configured')
    expect(() =>
      db.transaction(() => {
        partners.savePartner({ ...old, name: 'must-rollback' })
        service.setEnabled(
          old.id,
          skills.map((skill) => skill.id)
        )
      })
    ).toThrow(/64 KiB/)
    expect((await partners.getPartner(old.id))?.name).toBe('configured')
    expect(service.getSelection(old.id).skillIds).toEqual([skills[0].id])
    expect(() =>
      db.transaction(() => {
        partners.savePartner({ ...old, id: 'new-partner', name: 'new' })
        service.setEnabled(
          'new-partner',
          skills.map((skill) => skill.id)
        )
      })
    ).toThrow(/64 KiB/)
    expect(await partners.getPartner('new-partner')).toBeNull()
  })

  it('reports current UTF-8 sizes and unavailable files without losing metadata', () => {
    const a = service.create({ name: 'valid', description: 'Size', body: '规范' })
    const b = service.create({ name: 'broken', description: 'Unavailable', body: 'Body' })
    fs.unlinkSync(path.join(root, 'skills', b.name, 'SKILL.md'))
    expect(service.listOptions()).toEqual(
      expect.arrayContaining([
        { ...a, bodyBytes: 6 },
        { ...b, bodyBytes: null }
      ])
    )
  })

  it('publishes an edited import draft with its unknown YAML and complete resources', () => {
    const source = path.join(root, 'import-draft')
    fs.mkdirSync(path.join(source, 'references'), { recursive: true })
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(source, 'references', 'guide.md'), '原始资料')
    const pending = service.prepareImport(source, 7)
    expect(pending.resources).toEqual(['references/guide.md'])
    expect(service.list()).toEqual([])
    const saved = service.commitImport(
      {
        ...pending,
        name: 'renamed-import',
        description: 'Updated purpose',
        body: '# 新规范\n\n保留资源。',
        replaceId: null
      },
      7
    )
    expect(service.getDocument(saved.id)).toMatchObject({
      name: 'renamed-import',
      body: '# 新规范\n\n保留资源。',
      resources: pending.resources
    })
    expect(fs.readFileSync(path.join(root, 'skills', saved.name, 'SKILL.md'), 'utf8')).toContain(
      'keep-me'
    )
    expect(service.previewResource({ id: saved.id }, pending.resources[0])).toEqual({
      text: '原始资料'
    })
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe(markdown())
    expect(() =>
      service.previewResource({ token: pending.token }, pending.resources[0], 7)
    ).toThrow(/expired/)
  })

  it('rechecks the replacement identity and edited name without overwriting another skill', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    const other = service.create({ name: 'other', description: 'Keep', body: 'Keep' })
    service.setEnabled('alice', [original.id])
    const source = path.join(root, 'replacement-draft')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const pending = service.prepareImport(source)
    expect(() =>
      service.commitImport({ ...pending, name: other.name, replaceId: original.id })
    ).toThrow(/already exists/)
    expect(service.getDocument(other.id).body).toBe('Keep')
    expect(
      service.commitImport({
        ...pending,
        name: 'renamed',
        body: 'Replacement',
        replaceId: original.id
      }).id
    ).toBe(original.id)
    expect(service.listEnabled('alice').map((skill) => skill.name)).toEqual(['renamed'])
    const stale = service.prepareImport(source)
    service.delete(original.id)
    expect(() => service.commitImport({ ...stale, replaceId: original.id })).toThrow(
      /changed during import/
    )
    service.cancelImport(stale.token)
  })

  it('scopes resource previews to their owner and directory without executing files', () => {
    const source = path.join(root, 'resource-preview')
    fs.mkdirSync(path.join(source, 'references'), { recursive: true })
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(source, 'references', 'guide.md'), 'Guide')
    fs.writeFileSync(path.join(source, 'large.txt'), 'x'.repeat(256 * 1024 + 1))
    fs.writeFileSync(path.join(source, 'binary.dat'), Buffer.from([0, 255]))
    const pending = service.prepareImport(source, 3)
    expect(() =>
      service.previewResource({ token: pending.token }, 'references/guide.md', 4)
    ).toThrow(/expired/)
    expect(service.previewResource({ token: pending.token }, 'references/guide.md', 3)).toEqual({
      text: 'Guide'
    })
    expect(service.previewResource({ token: pending.token }, 'large.txt', 3)).toBeNull()
    expect(service.previewResource({ token: pending.token }, 'binary.dat', 3)).toBeNull()
    for (const relative of [
      '../app.sqlite',
      '/app.sqlite',
      'C:\\outside',
      'references/../SKILL.md'
    ])
      expect(() => service.previewResource({ token: pending.token }, relative, 3)).toThrow(
        /Invalid/
      )
    const saved = service.commitImport({ ...pending, replaceId: null }, 3)
    expect(service.resourceDirectory({ id: saved.id })).toBe(path.join(root, 'skills', saved.name))
    if (process.platform !== 'win32') {
      const folder = path.join(root, 'skills', saved.name, 'references')
      fs.rmSync(folder, { recursive: true })
      fs.symlinkSync(source, folder, 'dir')
      expect(() => service.previewResource({ id: saved.id }, 'references/SKILL.md')).toThrow(
        /symbolic/
      )
      expect(() => service.getDocument(saved.id)).toThrow(/symbolic/)
    }
  })
})

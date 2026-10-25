import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import { PartnerSkillStore } from '../../../../src/main/services/storage/domains/PartnerSkillStore'
import {
  UserSkillService,
  parseSkillMarkdown
} from '../../../../src/main/services/skills/UserSkillService'

const importSkill = (source: string) =>
  service.commitImport({ ...service.prepareImport(source), replaceName: null })

const markdown = (name = 'example', body = 'Read references/guide.md first.') =>
  `---\nname: ${name}\ndescription: A reusable workflow\nlicense: MIT\nmetadata:\n  custom: keep-me\n---\n${body}\n`
let root: string
let db: SqliteCore
let store: PartnerSkillStore
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
  store = new PartnerSkillStore(db)
  service = new UserSkillService(store, path.join(root, 'skills'))
})
afterEach(() => {
  service?.dispose()
  db?.close()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('shared user Skill files and partner bindings', () => {
  const write = (
    name = 'example',
    body = 'Original',
    description = 'A reusable workflow'
  ): string => {
    const directory = path.join(service.getRootDirectory(), name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      markdown(name, body).replace('A reusable workflow', description)
    )
    return directory
  }

  it('discovers files immediately without an index table or query writes', () => {
    expect(service.statusForPartner('alice')).toEqual([])
    expect(fs.existsSync(service.getRootDirectory())).toBe(false)
    write()
    const before = db.prepare('SELECT total_changes() AS n').get()
    expect(service.statusForPartner('alice')).toEqual([{ name: 'example', enabled: false }])
    expect(service.list()).toEqual([{ name: 'example', description: 'A reusable workflow' }])
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'user_skill'").get()
    ).toBeUndefined()
    expect(() => service.statusForPartner('alice', 'missing')).toThrow(/not found/)
  })

  it('configures freshly created directories without rewriting or executing files', async () => {
    const changed = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), changed)
    const directory = write()
    fs.mkdirSync(path.join(directory, 'scripts'))
    const script = path.join(directory, 'scripts/run.sh')
    fs.writeFileSync(script, `#!/bin/sh\ntouch '${path.join(root, 'unexpected-execution')}'\n`, {
      mode: 0o751
    })
    const raw = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')
    service.create({ name: 'other', description: 'Other', body: 'Keep' })
    service.setEnabled('alice', ['other'])
    expect(service.configureForPartner('alice', 'example', true)).toEqual({
      name: 'example',
      enabled: true
    })
    service.setEnabled('bob', ['example'])
    expect(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')).toBe(raw)
    expect(fs.existsSync(path.join(root, 'unexpected-execution'))).toBe(false)
    if (process.platform !== 'win32') expect(fs.statSync(script).mode & 0o777).toBe(0o751)
    write('example', 'Updated', 'New description')
    expect(service.getDocument('example').description).toBe('New description')
    service.configureForPartner('alice', 'example', false)
    expect(store.listEnabled('alice')).toEqual(['other'])
    expect(store.listEnabled('bob')).toEqual(['example'])
    expect(service.getDocument('example').resources).toEqual(['scripts/run.sh'])
    await Promise.resolve()
    expect(changed).toHaveBeenCalled()
  })

  it('checks complete configuration budgets and preserves direct edits on rejection', () => {
    write('target', 'x'.repeat(40 * 1024))
    service.configureForPartner('alice', 'target', true)
    service.create({ name: 'other', description: 'Other', body: 'x'.repeat(20 * 1024) })
    service.setEnabled('alice', ['target', 'other'])
    service.setEnabled('bob', ['target', 'other'])
    write('target', 'x'.repeat(50 * 1024), 'Changed')
    expect(() => service.configureForPartner('alice', 'target', true)).toThrow(/64 KiB/)
    expect(service.getDocument('target').body.length).toBeGreaterThan(50 * 1024)
    service.configureForPartner('alice', 'target', false)
    expect(store.listEnabled('alice')).toEqual(['other'])
    expect(store.listEnabled('bob')).toEqual(['other', 'target'])
  })

  it('rolls back a configuration failure without touching directory content', async () => {
    const notify = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), notify)
    write()
    const fail = vi.spyOn(store, 'setEnabled').mockImplementation(() => {
      throw new Error('database failure')
    })
    try {
      expect(() => service.configureForPartner('alice', 'example', true)).toThrow(
        'database failure'
      )
    } finally {
      fail.mockRestore()
    }
    expect(store.listEnabled('alice')).toEqual([])
    expect(service.getDocument('example').body).toContain('Original')
    await Promise.resolve()
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports missing configured names and permits disabling broken files', () => {
    const directory = write()
    service.configureForPartner('alice', 'example', true)
    fs.writeFileSync(path.join(directory, 'SKILL.md'), 'invalid')
    expect(service.list()).toEqual([])
    expect(service.listOptions()[0].error).toContain('frontmatter')
    expect(() => service.configureForPartner('alice', 'example', true)).toThrow(/frontmatter/)
    fs.rmSync(directory, { recursive: true })
    expect(service.statusForPartner('alice')).toEqual([{ name: 'example', enabled: true }])
    expect(service.getSelection('alice').unavailableSkillNames).toEqual(['example'])
    service.configureForPartner('alice', 'example', false)
    expect(service.statusForPartner('alice')).toEqual([])
    expect(() => service.configureForPartner('alice', '../escape', true)).toThrow(/name/)
  })

  it('automatically notifies directory, body and nested resource changes without configuration writes', async () => {
    const notify = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), notify)
    service.startWatching()
    const before = db.prepare('SELECT total_changes() AS n').get()
    const directory = write()
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    notify.mockClear()
    fs.mkdirSync(path.join(directory, 'references'))
    fs.writeFileSync(path.join(directory, 'references/rules.md'), 'Resource')
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    notify.mockClear()
    write('example', 'Changed body')
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    expect(service.getDocument('example').body).toContain('Changed body')
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })

  it('keeps observing after the Skill root is replaced externally', async () => {
    const notify = vi.fn()
    service = new UserSkillService(store, path.join(root, 'skills'), notify)
    service.startWatching()
    write()
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    notify.mockClear()
    fs.renameSync(service.getRootDirectory(), path.join(root, 'previous-skills'))
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    notify.mockClear()
    write('replacement')
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    notify.mockClear()
    write('replacement', 'New content')
    await vi.waitFor(() => expect(notify).toHaveBeenCalled(), { timeout: 5000 })
    expect(service.getDocument('replacement').body).toContain('New content')
  })

  it('checks rename budgets against the final deduplicated choices', () => {
    service.create({ name: 'source', description: 'Source', body: 'x'.repeat(40 * 1024) })
    service.create({ name: 'destination', description: 'Destination', body: 'y'.repeat(20 * 1024) })
    service.setEnabled('alice', ['source', 'destination'])
    fs.rmSync(path.join(service.getRootDirectory(), 'destination'), { recursive: true })
    service.update({
      originalName: 'source',
      name: 'destination',
      description: 'Renamed',
      body: 'x'.repeat(40 * 1024)
    })
    expect(service.getSelection('alice').skillNames).toEqual(['destination'])
    expect(service.loadEnabled('alice', 'destination').body.length).toBe(40 * 1024)
  })

  it('does not infer a rename from external directory changes', () => {
    const directory = write()
    service.configureForPartner('alice', 'example', true)
    fs.renameSync(directory, path.join(service.getRootDirectory(), 'renamed'))
    write('renamed')
    expect(service.statusForPartner('alice')).toEqual([
      { name: 'example', enabled: true },
      { name: 'renamed', enabled: false }
    ])
    service.configureForPartner('alice', 'example', false)
    expect(store.listEnabled('alice')).toEqual([])
  })

  it('creates a standard Skill, stores only partner choices, and requires a partner binding', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    expect(skill.name).toBe('example')
    expect(service.listEnabled('alice')).toEqual([])
    expect(() => service.loadEnabled('alice', skill.name)).toThrow(/not enabled/)
    service.setEnabled('alice', [skill.name, skill.name])
    expect(service.listEnabled('alice')).toEqual([skill])
    expect(service.listEnabled('bob')).toEqual([])
    expect(() => service.loadEnabled('bob', skill.name)).toThrow(/not enabled/)
    const loaded = service.loadEnabled('alice', skill.name)
    expect(loaded.body).toContain('references/guide.md')
    expect(loaded.resourceBase).toBe(path.join(root, 'skills', 'example'))
    expect(
      parseSkillMarkdown(fs.readFileSync(path.join(loaded.resourceBase, 'SKILL.md'), 'utf8'))
    ).toMatchObject({ name: 'example', description: 'A reusable workflow' })
    const columns = db.prepare('PRAGMA table_info(partner_user_skill)').all() as { name: string }[]
    expect(columns.map((column) => column.name)).toEqual(['partner_id', 'skill_name'])
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
    service.setEnabled('alice', [skill.name])
    const { resourceBase } = service.loadEnabled('alice', skill.name)
    expect(fs.readFileSync(path.join(resourceBase, 'SKILL.md'), 'utf8')).toBe(markdown())
    expect(fs.readFileSync(path.join(resourceBase, 'assets', 'sample.bin'))).toEqual(binary)
    expect(fs.readFileSync(path.join(resourceBase, 'custom-resource.data'), 'utf8')).toBe('custom')
    expect(fs.readFileSync(path.join(resourceBase, 'scripts', 'run.py'), 'utf8')).toContain(
      'MUST NOT RUN'
    )
  })

  it('persists bindings across reopening and disables only the selected partner', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [skill.name])
    service.setEnabled('bob', [skill.name])
    db.close()
    db = new SqliteCore(path.join(root, 'app.sqlite'))
    db.initialize()
    store = new PartnerSkillStore(db)
    service = new UserSkillService(store, path.join(root, 'skills'))
    expect(service.loadEnabled('alice', skill.name).skill.name).toBe(skill.name)
    service.setEnabled('alice', [])
    expect(() => service.loadEnabled('alice', skill.name)).toThrow(/not enabled/)
    expect(service.loadEnabled('bob', skill.name).skill.name).toBe(skill.name)
    expect(() => service.setEnabled('bob', ['missing'])).toThrow(/not found/)
    expect(service.listEnabled('bob')).toEqual([skill])
  })

  it('can disable broken assets independently without validating retained broken files', () => {
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    const b = service.create(parseSkillMarkdown(markdown('beta')))
    service.setEnabled('alice', [a.name, b.name])
    fs.rmSync(path.join(root, 'skills', 'alpha', 'SKILL.md'))
    fs.rmSync(path.join(root, 'skills', 'beta', 'SKILL.md'))
    service.setEnabled('alice', [b.name])
    expect(service.getSelection('alice').skillNames).toEqual([b.name])
    service.setEnabled('alice', [])
    expect(service.listEnabled('alice')).toEqual([])
  })

  it('rejects duplicate names atomically and leaves prior content and bindings intact', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [original.name])
    expect(() => service.create(parseSkillMarkdown(markdown('example', 'Replacement')))).toThrow(
      /already exists/
    )
    expect(service.loadEnabled('alice', original.name).body).not.toContain('Replacement')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('cascades binding removal but not shared assets when a partner is deleted', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [skill.name])
    service.setEnabled('bob', [skill.name])
    db.prepare('DELETE FROM partner WHERE id = ?').run('alice')
    expect(service.listEnabled('alice')).toEqual([])
    expect(service.loadEnabled('bob', skill.name).body).toContain('guide')
    service.delete(skill.name)
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
    service.setEnabled('alice', [skill.name])
    const skillFile = path.join(root, 'skills', 'example', 'SKILL.md')
    fs.rmSync(skillFile)
    const external = path.join(root, 'external.md')
    fs.writeFileSync(external, markdown('example', 'PRIVATE'))
    fs.symlinkSync(external, skillFile)
    expect(() => service.loadEnabled('alice', skill.name)).toThrow(/symbolic links/)
    expect(fs.readFileSync(external, 'utf8')).toContain('PRIVATE')
  })

  it('rejects tampered managed paths and metadata on each runtime load', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [skill.name])
    fs.writeFileSync(path.join(root, 'skills', 'example', 'SKILL.md'), markdown('renamed'))
    expect(() => service.loadEnabled('alice', skill.name)).toThrow(/must match/)
    expect(() => service.loadEnabled('alice', '../outside')).toThrow(/not enabled/)
  })

  it('removes broken metadata entries even when their asset directory was deleted externally', () => {
    const skill = service.create(parseSkillMarkdown(markdown()))
    fs.rmSync(path.join(root, 'skills', 'example'), { recursive: true })
    service.delete(skill.name)
    expect(service.list()).toEqual([])
  })

  it('sorts catalogs deterministically independently of import/binding order', () => {
    const z = service.create(parseSkillMarkdown(markdown('zebra')))
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    service.setEnabled('alice', [z.name, a.name])
    service.setEnabled('bob', [a.name, z.name])
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
    expect(service.getDocument(long.name).body.length).toBe(40 * 1024)
    service.setEnabled('alice', [long.name, extra.name])
    expect(service.loadEnabled('alice', long.name).body.length).toBe(40 * 1024)
    expect(service.getSelection('alice').bodyBytes).toBe(64 * 1024)
    expect(() =>
      service.update({
        ...service.getDocument(long.name),
        originalName: long.name,
        body: 'z'.repeat(41 * 1024)
      })
    ).toThrow(/alice/)
    expect(service.getDocument(long.name).body).toBe('x'.repeat(40 * 1024))
    service.setEnabled('alice', [long.name])
    service.update({
      ...service.getDocument(long.name),
      originalName: long.name,
      body: 'z'.repeat(60 * 1024)
    })
    expect(service.loadEnabled('alice', long.name).body.length).toBe(60 * 1024)
    const unbound = service.create({
      name: 'unbound',
      description: 'Stored only',
      body: 'w'.repeat(80 * 1024)
    })
    expect(service.getDocument(unbound.name).body.length).toBe(80 * 1024)
    expect(() => service.setEnabled('bob', [unbound.name])).toThrow(/64 KiB/)
    expect(service.getSelection('bob').skillNames).toEqual([])
  })

  it('imports and replaces long instructions and rolls back when bound partners exceed their allowance', () => {
    const source = path.join(root, 'long-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'a'.repeat(40 * 1024)))
    const saved = importSkill(source)
    service.setEnabled('alice', [saved.name])
    service.setEnabled('bob', [saved.name])
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'b'.repeat(60 * 1024)))
    const accepted = service.prepareImport(source)
    expect(service.commitImport({ ...accepted, replaceName: saved.name }).name).toBe(saved.name)
    expect(service.loadEnabled('bob', saved.name).body).toContain('b'.repeat(60 * 1024))
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('long-import', 'c'.repeat(65 * 1024)))
    const rejected = service.prepareImport(source)
    expect(() => service.commitImport({ ...rejected, replaceName: saved.name })).toThrow(
      /alice、bob/
    )
    expect(service.loadEnabled('alice', saved.name).body).toContain('b'.repeat(60 * 1024))
    service.cancelImport(rejected.token)
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['long-import'])
  })

  it('edits and renames imported files while updating names and bindings, unknown YAML and resources', () => {
    const source = path.join(root, 'editable-source')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    fs.writeFileSync(path.join(source, 'resource.bin'), Buffer.from([0, 255, 10]))
    const original = importSkill(source)
    service.setEnabled('alice', [original.name])
    service.setEnabled('bob', [original.name])
    const edited = service.update({
      ...service.getDocument(original.name),
      originalName: original.name,
      name: 'renamed',
      description: 'Updated description',
      body: '# Updated\nUse the new rules.'
    })
    expect(edited.name).toBe('renamed')
    expect(service.listEnabled('alice')[0].name).toBe('renamed')
    expect(service.listEnabled('bob')[0].name).toBe('renamed')
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
    service.setEnabled('alice', [original.name])
    const source = path.join(root, 'replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('example', 'Replacement body'))
    const cancelled = service.prepareImport(source, 7)
    expect(() => service.commitImport({ ...cancelled, replaceName: original.name }, 8)).toThrow(
      /expired/
    )
    service.cancelImport(cancelled.token, 8)
    service.cancelImport(cancelled.token, 7)
    expect(service.loadEnabled('alice', original.name).body).not.toContain('Replacement')
    const next = service.prepareImport(source, 7)
    expect(() => service.commitImport({ ...next, replaceName: null }, 7)).toThrow(/already exists/)
    expect(service.commitImport({ ...next, replaceName: original.name }, 7).name).toBe(
      original.name
    )
    expect(service.loadEnabled('alice', original.name).body).toContain('Replacement body')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
  })

  it('rolls back files and metadata when SQLite rejects an edit or replacement', () => {
    const original = service.create(parseSkillMarkdown(markdown()))
    service.setEnabled('alice', [original.name])
    db.exec(
      "CREATE TRIGGER reject_skill_update BEFORE INSERT ON partner_user_skill BEGIN SELECT RAISE(ABORT, 'forced update failure'); END;"
    )
    expect(() =>
      service.update({
        ...service.getDocument(original.name),
        originalName: original.name,
        name: 'renamed',
        body: 'New body'
      })
    ).toThrow(/forced update failure/)
    expect(service.loadEnabled('alice', original.name).body).toContain('guide')
    expect(service.getDocument(original.name).name).toBe('example')
    expect(fs.readdirSync(path.join(root, 'skills'))).toEqual(['example'])
    const source = path.join(root, 'replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('example', 'Replacement body'))
    const pending = service.prepareImport(source)
    expect(() =>
      service.commitImport({ ...pending, name: 'renamed', replaceName: original.name })
    ).toThrow(/forced update failure/)
    expect(service.loadEnabled('alice', original.name).body).toContain('guide')
    expect(service.getDocument(original.name).name).toBe(original.name)
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
    service.setEnabled('alice', [a.name, b.name, c.name])
    service.setEnabled('bob', [a.name, b.name, c.name])
    expect(service.getSelection('alice').bodyBytes).toBe(64 * 1024)
    expect(() => service.setEnabled('alice', [a.name, b.name, c.name, extra.name])).toThrow(
      /64 KiB/
    )
    expect(service.getSelection('alice').skillNames).not.toContain(extra.name)
    expect(() => service.setEnabled('alice', [a.name, b.name, c.name])).not.toThrow()
    expect(() =>
      service.update({
        ...service.getDocument(a.name),
        originalName: a.name,
        body: 'y'.repeat(29 * 1024)
      })
    ).toThrow(/alice、bob/)
    const source = path.join(root, 'budget-replacement')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown('alpha', 'z'.repeat(29 * 1024)))
    const pending = service.prepareImport(source)
    expect(() => service.commitImport({ ...pending, replaceName: a.name })).toThrow(/alice、bob/)
    service.cancelImport(pending.token)
    expect(service.getDocument(a.name).body).toBe('x'.repeat(28 * 1024))
    service.setEnabled('alice', [a.name])
    expect(service.getSelection('alice').bodyBytes).toBe(28 * 1024)
  })

  it('counts UTF-8 bytes and revalidates unchanged selections after external edits', () => {
    const make = (name: string) =>
      service.create({ name, description: 'Budget', body: '规'.repeat(9000) })
    const a = make('alpha'),
      b = make('beta'),
      c = service.create({ name: 'small', description: 'Budget', body: 'x'.repeat(8 * 1024) })
    service.setEnabled('alice', [a.name, b.name, c.name])
    expect(service.getSelection('alice').bodyBytes).toBe(54_000 + 8 * 1024)
    for (const skill of [a, b])
      fs.writeFileSync(
        path.join(root, 'skills', skill.name, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: Budget\n---\n${'规'.repeat(10000)}`
      )
    expect(() => service.setEnabled('alice', [a.name, b.name, c.name])).toThrow(/64 KiB/)
    // A strict removal can release configuration even when a retained asset is unreadable.
    fs.unlinkSync(path.join(root, 'skills', a.name, 'SKILL.md'))
    expect(() => service.setEnabled('alice', [a.name, b.name])).not.toThrow()
    expect(service.getSelection('alice').unavailableSkillNames).toEqual(['alpha'])
  })

  it('rejects rename collisions without changing either skill', () => {
    const a = service.create(parseSkillMarkdown(markdown('alpha')))
    service.create(parseSkillMarkdown(markdown('beta')))
    expect(() =>
      service.update({ ...service.getDocument(a.name), originalName: a.name, name: 'beta' })
    ).toThrow(/already exists/)
    expect(service.getDocument(a.name).name).toBe('alpha')
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
      service.setEnabled(old.id, [skills[0].name])
    })
    expect((await partners.getPartner(old.id))?.name).toBe('configured')
    expect(() =>
      db.transaction(() => {
        partners.savePartner({ ...old, name: 'must-rollback' })
        service.setEnabled(
          old.id,
          skills.map((skill) => skill.name)
        )
      })
    ).toThrow(/64 KiB/)
    expect((await partners.getPartner(old.id))?.name).toBe('configured')
    expect(service.getSelection(old.id).skillNames).toEqual([skills[0].name])
    expect(() =>
      db.transaction(() => {
        partners.savePartner({ ...old, id: 'new-partner', name: 'new' })
        service.setEnabled(
          'new-partner',
          skills.map((skill) => skill.name)
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
        expect.objectContaining({
          name: b.name,
          description: '',
          bodyBytes: null,
          error: expect.any(String)
        })
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
        replaceName: null
      },
      7
    )
    expect(service.getDocument(saved.name)).toMatchObject({
      name: 'renamed-import',
      body: '# 新规范\n\n保留资源。',
      resources: pending.resources
    })
    expect(fs.readFileSync(path.join(root, 'skills', saved.name, 'SKILL.md'), 'utf8')).toContain(
      'keep-me'
    )
    expect(service.previewResource({ name: saved.name }, pending.resources[0])).toEqual({
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
    service.setEnabled('alice', [original.name])
    const source = path.join(root, 'replacement-draft')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'SKILL.md'), markdown())
    const pending = service.prepareImport(source)
    expect(() =>
      service.commitImport({ ...pending, name: other.name, replaceName: original.name })
    ).toThrow(/already exists/)
    expect(service.getDocument(other.name).body).toBe('Keep')
    expect(
      service.commitImport({
        ...pending,
        name: 'renamed',
        body: 'Replacement',
        replaceName: original.name
      }).name
    ).toBe('renamed')
    expect(service.listEnabled('alice').map((skill) => skill.name)).toEqual(['renamed'])
    const stale = service.prepareImport(source)
    service.delete('renamed')
    expect(() => service.commitImport({ ...stale, replaceName: 'renamed' })).toThrow(/not found/)
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
    const saved = service.commitImport({ ...pending, replaceName: null }, 3)
    expect(service.resourceDirectory({ name: saved.name })).toBe(
      path.join(root, 'skills', saved.name)
    )
    if (process.platform !== 'win32') {
      const folder = path.join(root, 'skills', saved.name, 'references')
      fs.rmSync(folder, { recursive: true })
      fs.symlinkSync(source, folder, 'dir')
      expect(() => service.previewResource({ name: saved.name }, 'references/SKILL.md')).toThrow(
        /symbolic/
      )
      expect(() => service.getDocument(saved.name)).toThrow(/symbolic/)
    }
  })
})

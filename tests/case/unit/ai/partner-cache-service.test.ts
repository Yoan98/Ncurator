import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqliteCore } from '../../../../src/main/services/storage/sqlite/SqliteCore'
import { PartnerStore } from '../../../../src/main/services/storage/domains/PartnerStore'
import {
  WorkbenchUiStore,
  createEmptyPartnerUiState
} from '../../../../src/main/services/storage/domains/WorkbenchUiStore'
import { AiFileChangeStore } from '../../../../src/main/services/storage/domains/AiFileChangeStore'
import { ChatMessageLogStore } from '../../../../src/main/services/storage/domains/ChatMessageLogStore'
import { PartnerCacheService } from '../../../../src/main/services/assets/PartnerCacheService'
import { getPartnerRuntimeDir } from '../../../../src/main/services/assets/WorkspaceAssetService'
import { AiFileChangeService } from '../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { AttachmentService } from '../../../../src/main/services/attachments/AttachmentService'
import type { PartnerCacheRequest } from '../../../../src/shared/partnerCache'

describe('partner-cache-service', () => {
  let root: string,
    sqlite: SqliteCore,
    partners: PartnerStore,
    ui: WorkbenchUiStore,
    records: AiFileChangeStore,
    changes: AiFileChangeService,
    cache: PartnerCacheService,
    busy: boolean
  const before = new Date('2026-09-01T00:00:00+08:00').getTime()
  const old = before - 86_400_000
  const request = (categories: PartnerCacheRequest['categories']): PartnerCacheRequest => ({
    partnerIds: ['a'],
    categories,
    before
  })
  const writeCache = async (partner: string, relative: string, time = old): Promise<string> => {
    const file = path.join(getPartnerRuntimeDir(partner), relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `cache:${relative}`)
    await fs.utimes(file, new Date(time), new Date(time))
    return file
  }
  const exists = async (file: string) =>
    fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  const edit = async (source: string, run: string, content: string, time: number) => {
    const result = await changes.sessions.write('a', run, {
      sourcePath: source,
      buffer: Buffer.from(content),
      capability: 'text_file'
    })
    await changes.sessions.finalize('a', run)
    const record = (await records.getRecord({ changeId: result.record.id })).record!
    await records.saveRecord({ ...record, createdAt: time })
    return { ...record, createdAt: time }
  }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'partner-cache-'))
    vi.stubEnv('NCURATOR_USER_DATA_PATH', path.join(root, 'user-data'))
    sqlite = new SqliteCore(path.join(root, 'app.sqlite'))
    sqlite.initialize()
    partners = new PartnerStore(sqlite)
    ui = new WorkbenchUiStore(sqlite)
    records = new AiFileChangeStore(sqlite)
    changes = new AiFileChangeService(records)
    busy = false
    cache = new PartnerCacheService({
      partners,
      ui,
      fileChanges: records,
      isPartnerBusy: () => busy
    })
    for (const id of ['a', 'b'])
      await partners.savePartner({
        id,
        name: id,
        avatar_shape: 'circle',
        avatar_color: 'blue',
        pinned: false,
        pinned_at: null,
        created_at: old,
        updated_at: old,
        last_viewed_at: old
      })
  })
  afterEach(async () => {
    sqlite?.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('partner-cache-time-and-partner-isolation', async () => {
    const deleted = await writeCache('a', 'scripts/old.py')
    const boundary = await writeCache('a', 'scripts/boundary.py', before)
    const other = await writeCache('b', 'scripts/old.py')
    const oldPage = await writeCache('a', 'assets/presentation/old.svg')
    const newPage = await writeCache('a', 'assets/presentation/new.svg', before)
    const log = new ChatMessageLogStore(sqlite)
    await log.appendBatch({
      partnerId: 'a',
      runId: 'history',
      entries: [
        {
          kind: 'user',
          content: 'retain chat',
          input: 'retain chat',
          context: { selectedReferences: [], attachments: [] }
        }
      ]
    })
    const preview = await cache.preview(request(['scripts', 'assets']))
    expect(preview.success).toBe(true)
    expect(preview.rows.reduce((sum, row) => sum + row.count, 0)).toBe(1)
    const result = await cache.cleanup(request(['scripts', 'assets']))
    expect(result.success).toBe(true)
    expect(result.deletedCount).toBe(1)
    expect(await exists(deleted)).toBe(false)
    for (const file of [boundary, other, oldPage, newPage]) expect(await exists(file)).toBe(true)
    expect((await log.list('a'))[0].entry.kind).toBe('user')
    expect(await partners.getPartner('a')).not.toBeNull()
  })

  it('partner-cache-protects-draft-attachments', async () => {
    const attachment = await new AttachmentService().saveAttachment({
      partnerId: 'a',
      assetBucketId: 'draft',
      name: 'pasted.png',
      bytes: new Uint8Array([1, 2, 3]),
      kind: 'image',
      mimeType: 'image/png'
    })
    await fs.utimes(attachment.path, new Date(old), new Date(old))
    const sibling = await writeCache('a', 'assets/draft/render.png')
    const state = createEmptyPartnerUiState()
    state.composer.draft.attachments = [attachment]
    state.composer.draft.assetBucketId = 'draft'
    await ui.savePartnerState('a', state)
    const preview = await cache.preview(request(['assets']))
    expect(preview.rows).toEqual([])
    expect(preview.skippedCount).toBe(2)
    const result = await cache.cleanup(request(['assets']))
    expect(result.success).toBe(true)
    expect(result.skippedCount).toBe(2)
    expect(await exists(attachment.path)).toBe(true)
    expect(await exists(sibling)).toBe(true)
  })

  it('partner-cache-history-keeps-newer-backups-and-formal-files', async () => {
    const source = path.join(root, 'formal.md')
    await fs.writeFile(source, 'A')
    const first = await edit(source, 'first', 'B', old)
    const second = await edit(source, 'second', 'C', before)
    expect(first.beforeSnapshotPath).toContain(
      path.join('file-changes', 'first', first.id, 'before.md')
    )
    const result = await cache.cleanup(request(['file-changes']))
    expect(result.success).toBe(true)
    expect((await records.getRecord({ changeId: first.id })).record).toBeUndefined()
    expect(await exists(first.beforeSnapshotPath!)).toBe(false)
    expect(await exists(first.previewPath!)).toBe(false)
    expect(await fs.readFile(source, 'utf8')).toBe('C')
    expect(await fs.readFile(second.beforeSnapshotPath!, 'utf8')).toBe('B')
    expect((await changes.revertRecord({ changeId: second.id })).success).toBe(true)
    expect(await fs.readFile(source, 'utf8')).toBe('B')
  })

  it('partner-cache-identical-backups-remain-independent', async () => {
    const firstPath = path.join(root, 'first.md'),
      secondPath = path.join(root, 'second.md')
    await fs.writeFile(firstPath, 'A')
    await fs.writeFile(secondPath, 'A')
    const first = await edit(firstPath, 'first', 'B', old),
      second = await edit(secondPath, 'second', 'C', before)
    expect(first.beforeSnapshotPath).not.toBe(second.beforeSnapshotPath)
    for (const record of [first, second]) {
      expect(record.beforeSnapshotPath).toContain(
        path.join('file-changes', record.runId, record.id, 'before.md')
      )
      expect(await fs.readFile(record.beforeSnapshotPath!, 'utf8')).toBe('A')
    }
    expect((await cache.cleanup(request(['file-changes']))).success).toBe(true)
    const kept = (await records.getRecord({ changeId: second.id })).record!
    expect(kept.createdAt).toBe(before)
    expect(kept.beforeSnapshotPath).toBe(second.beforeSnapshotPath)
    expect(await fs.readFile(kept.beforeSnapshotPath!, 'utf8')).toBe('A')
    expect(await exists(first.beforeSnapshotPath!)).toBe(false)
    expect((await changes.revertRecord({ changeId: second.id })).success).toBe(true)
    expect(await fs.readFile(secondPath, 'utf8')).toBe('A')
  })

  it('partner-cache-running-and-cleaning-are-mutually-exclusive', async () => {
    const file = await writeCache('a', 'scripts/old.py')
    busy = true
    expect((await cache.cleanup(request(['scripts']))).success).toBe(false)
    busy = false
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = cache.withIdlePartner('a', () => waiting)
    try {
      expect(cache.isCleaning('a')).toBe(true)
      expect((await cache.cleanup(request(['scripts']))).success).toBe(false)
      expect(await exists(file)).toBe(true)
    } finally {
      release()
      await held
    }
    expect(cache.isCleaning('a')).toBe(false)
    expect((await cache.cleanup(request(['scripts']))).success).toBe(true)
  })

  it('partner-cache-rejects-invalid-scope-and-links', async () => {
    const external = path.join(root, 'external')
    await fs.mkdir(external)
    await fs.writeFile(path.join(external, 'keep.txt'), 'keep')
    await fs.mkdir(getPartnerRuntimeDir('a'), { recursive: true })
    await fs.symlink(
      external,
      path.join(getPartnerRuntimeDir('a'), 'scripts'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    expect((await cache.cleanup(request(['scripts']))).success).toBe(false)
    expect(await fs.readFile(path.join(external, 'keep.txt'), 'utf8')).toBe('keep')
    expect((await cache.cleanup({ ...request(['assets']), partnerIds: ['..'] })).success).toBe(
      false
    )
    expect((await cache.cleanup({ ...request(['assets']), before: NaN })).success).toBe(false)
    await expect(cache.directory('a', 'assets')).rejects.toThrow('暂无数据')
  })

  it('partner-cache-failure-retains-record-for-retry', async () => {
    const source = path.join(root, 'formal.md')
    await fs.writeFile(source, 'A')
    const record = await edit(source, 'first', 'B', old)
    const remove = fs.rm.bind(fs)
    const failure = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (String(args[0]) === record.previewPath)
        throw Object.assign(new Error('review locked'), { code: 'EACCES' })
      return await remove(...args)
    })
    expect((await cache.cleanup(request(['file-changes']))).success).toBe(false)
    expect((await records.getRecord({ changeId: record.id })).record).toBeDefined()
    expect(await fs.readFile(source, 'utf8')).toBe('B')
    failure.mockRestore()
    expect((await cache.cleanup(request(['file-changes']))).success).toBe(true)
    expect((await records.getRecord({ changeId: record.id })).record).toBeUndefined()
  })

  it('partner-cache-unrelated-history-does-not-block-script-cleanup', async () => {
    const source = path.join(root, 'formal.md')
    await fs.writeFile(source, 'A')
    const record = await edit(source, 'first', 'B', old)
    await fs.writeFile(record.beforeSnapshotPath!, 'damaged history')
    const script = await writeCache('a', 'scripts/old.py')
    expect((await cache.cleanup(request(['scripts']))).success).toBe(true)
    expect(await exists(script)).toBe(false)
    expect(await fs.readFile(record.beforeSnapshotPath!, 'utf8')).toBe('damaged history')
    expect((await records.getRecord({ changeId: record.id })).record).toBeDefined()
    expect((await cache.cleanup(request(['file-changes']))).success).toBe(true)
    expect(await exists(record.beforeSnapshotPath!)).toBe(false)
    expect(await fs.readFile(source, 'utf8')).toBe('B')
  })

  it('partner-cache-clear-context-can-preserve-or-delete-history', async () => {
    const source = path.join(root, 'formal.md')
    await fs.writeFile(source, 'A')
    const record = await edit(source, 'first', 'B', old)
    const script = await writeCache('a', 'scripts/old.py')
    await cache.withIdlePartner('a', () => cache.clearPartnerFiles('a', false))
    expect(await exists(script)).toBe(false)
    expect(await fs.readFile(record.beforeSnapshotPath!, 'utf8')).toBe('A')
    expect((await records.getRecord({ changeId: record.id })).record).toBeDefined()
    await cache.withIdlePartner('a', () => cache.clearPartnerFiles('a', true))
    expect((await records.getRecord({ changeId: record.id })).record).toBeUndefined()
    expect(await exists(record.beforeSnapshotPath!)).toBe(false)
    expect(await fs.readFile(source, 'utf8')).toBe('B')
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AiFileChangeRecord,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse
} from '../../../../src/shared/types'
import { AiFileChangeService } from '../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { NO_EFFECTIVE_FILE_CHANGE_MESSAGE } from '../../../../src/shared/constants'

const checksum = (value: string): string => createHash('sha256').update(value).digest('hex')

class MemoryAiFileChangeStore {
  private records = new Map<string, AiFileChangeRecord>()

  public async saveRecord(record: AiFileChangeRecord): Promise<void> {
    this.records.set(record.id, record)
  }

  public async listRecords(
    filters?: ListAiFileChangeRecordsRequest
  ): Promise<ListAiFileChangeRecordsResponse> {
    const items = Array.from(this.records.values()).filter(
      (record) =>
        (!filters?.partnerId || record.partnerId === filters.partnerId) &&
        (!filters?.runId || record.runId === filters.runId) &&
        (!filters?.status || record.status === filters.status)
    )
    return { items, total: items.length }
  }

  public async getRecord(
    request: GetAiFileChangeRecordRequest
  ): Promise<GetAiFileChangeRecordResponse> {
    const record = this.records.get(request.changeId)
    return record ? { record } : { error: 'file change record not found' }
  }
}

const createRecord = (input: Partial<AiFileChangeRecord>): AiFileChangeRecord => ({
  id: input.id || 'change-1',
  partnerId: input.partnerId || 'partner-1',
  runId: input.runId || 'run-1',
  status: input.status || 'applied',
  capability: input.capability || 'text_file',
  path: input.path || '',
  fileName: input.fileName || 'target.txt',
  operation: input.operation || 'updated',
  source: input.source,
  beforePath: input.beforePath,
  afterPath: input.afterPath,
  changeCount: input.changeCount ?? 1,
  insertCount: input.insertCount ?? 1,
  deleteCount: input.deleteCount ?? 0,
  beforeSnapshotPath: input.beforeSnapshotPath,
  afterSnapshotPath: input.afterSnapshotPath,
  beforeObjectHash: input.beforeObjectHash,
  afterObjectHash: input.afterObjectHash,
  previewArtifactHash: input.previewArtifactHash,
  beforeChecksum: input.beforeChecksum,
  afterChecksum: input.afterChecksum,
  previewPath: input.previewPath,
  runSummary: input.runSummary,
  createdAt: input.createdAt || 1,
  updatedAt: input.updatedAt || 1,
  revertedAt: input.revertedAt,
  error: input.error
})

describe('ai file change service', () => {
  let tempDir = ''
  let store: MemoryAiFileChangeStore
  let service: AiFileChangeService

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-file-change-'))
    store = new MemoryAiFileChangeStore()
    service = new AiFileChangeService(store)
  })

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('stores direct tool snapshots immediately without a run-end scan', async () => {
    const targetPath = path.join(tempDir, 'deck.pptx')
    const previewPath = path.join(tempDir, '.ncurator', 'runtime', 'ppt-diff.json')
    await fs.writeFile(targetPath, 'ppt bytes')
    await fs.mkdir(path.dirname(previewPath), { recursive: true })
    await fs.writeFile(previewPath, JSON.stringify({ version: 1, slides: [] }))
    await service.saveRecord(
      createRecord({
        id: 'ppt-change',
        runId: 'ppt-run',
        capability: 'ppt',
        path: targetPath,
        fileName: 'deck.pptx',
        operation: 'created',
        previewPath
      })
    )

    const completed = await service.getRecord({ changeId: 'ppt-change' })
    expect(completed.record?.id).toBe('ppt-change')
    expect(completed.record?.capability).toBe('ppt')
    expect(completed.record?.previewPath).toBeTruthy()
    expect(completed.record?.afterSnapshotPath).toBeTruthy()
    const manifest = JSON.parse(
      await fs.readFile(completed.record!.previewPath!, 'utf8')
    ) as Record<string, unknown>
    expect(manifest.version).toBe(1)
  })

  it('preserves a verified specialist change under ignored runtime assets', async () => {
    const targetPath = path.join(tempDir, '.ncurator', 'runtime', 'assets', 'bucket', 'input.docx')
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'before')
    await fs.writeFile(targetPath, 'after')
    await service.saveRecord(
      createRecord({
        id: 'attachment-change',
        runId: 'attachment-run',
        capability: 'docx',
        source: 'docx_tool',
        path: targetPath,
        fileName: 'input.docx',
        beforeChecksum: checksum('before'),
        afterChecksum: checksum('after')
      })
    )

    const completed = await service.getRecord({ changeId: 'attachment-change' })
    expect(completed.record?.status).toBe('applied')
    expect(completed.record?.error).toBeUndefined()
    expect((await service.getRecord({ changeId: 'attachment-change' })).record?.status).toBe(
      'applied'
    )
  })

  it('marks a specialist no-op with the user-facing no-change reason', async () => {
    const targetPath = path.join(tempDir, '.ncurator', 'runtime', 'assets', 'bucket', 'input.docx')
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'same')
    await service.saveRecord(
      createRecord({
        id: 'no-op-change',
        runId: 'no-op-run',
        capability: 'docx',
        source: 'docx_tool',
        path: targetPath,
        fileName: 'input.docx',
        beforeChecksum: checksum('same'),
        afterChecksum: checksum('same')
      })
    )

    const completed = await service.getRecord({ changeId: 'no-op-change' })
    expect(completed.record?.status).toBe('failed')
    expect(completed.record?.error).toBe(NO_EFFECTIVE_FILE_CHANGE_MESSAGE)
  })

  it('restores deleted and renamed files during revert', async () => {
    const deletedPath = path.join(tempDir, 'deleted.txt')
    const deletedSnapshot = path.join(tempDir, 'deleted.snapshot')
    await fs.writeFile(deletedSnapshot, 'deleted content')
    await store.saveRecord(
      createRecord({
        id: 'deleted-change',
        path: deletedPath,
        beforePath: deletedPath,
        operation: 'deleted',
        beforeSnapshotPath: deletedSnapshot
      })
    )
    expect((await service.revertRecord({ changeId: 'deleted-change' })).success).toBe(true)
    expect(await fs.readFile(deletedPath, 'utf8')).toBe('deleted content')

    const beforePath = path.join(tempDir, 'old.txt')
    const afterPath = path.join(tempDir, 'new.txt')
    const renameSnapshot = path.join(tempDir, 'rename.snapshot')
    await fs.writeFile(afterPath, 'renamed content')
    await fs.writeFile(renameSnapshot, 'renamed content')
    await store.saveRecord(
      createRecord({
        id: 'rename-change',
        path: afterPath,
        beforePath,
        afterPath,
        operation: 'renamed',
        beforeSnapshotPath: renameSnapshot
      })
    )
    expect((await service.revertRecord({ changeId: 'rename-change' })).success).toBe(true)
    expect(await fs.readFile(beforePath, 'utf8')).toBe('renamed content')
    await expect(fs.access(afterPath)).rejects.toThrow()
  })
})

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
        (!filters?.sessionId || record.sessionId === filters.sessionId) &&
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
  sessionId: input.sessionId || 'session-1',
  runId: input.runId || 'run-1',
  status: input.status || 'applied',
  capability: input.capability || 'terminal_exec',
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

  it('captures run changes and materializes text diff only when opened', async () => {
    const targetPath = path.join(tempDir, 'notes.txt')
    await fs.writeFile(targetPath, 'line 1\nline 2\nline 3\n')
    await service.beginRunTracking({
      runId: 'scan-run',
      sessionId: 'session-1',
      workspaceRootPath: tempDir,
      runSummary: '更新第二行'
    })
    await fs.writeFile(targetPath, 'line 1\nchanged\nline 3\n')

    const completed = await service.finishRunTracking('scan-run')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.record.operation).toBe('updated')
    expect(completed[0]?.record.previewPath).toBeUndefined()
    expect(completed[0]?.record.beforeObjectHash).not.toBe(completed[0]?.record.afterObjectHash)

    const opened = await service.getRecord({ changeId: completed[0]!.record.id })
    expect(opened.record?.previewPath).toBeTruthy()
    const artifact = JSON.parse(await fs.readFile(opened.record!.previewPath!, 'utf8')) as Record<
      string,
      unknown
    >
    expect(artifact.version).toBe(2)
    expect(artifact).not.toHaveProperty('afterLines')
    expect(opened.record?.insertCount).toBe(1)
    expect(opened.record?.deleteCount).toBe(1)

    const reopened = await service.getRecord({ changeId: completed[0]!.record.id })
    expect(reopened.record?.previewPath).toBe(opened.record?.previewPath)
  })

  it('preserves specialist PPT capability and diff preview after workspace scan', async () => {
    const targetPath = path.join(tempDir, 'deck.pptx')
    const previewPath = path.join(tempDir, '.ncurator', 'runtime', 'ppt-diff.json')
    await service.beginRunTracking({
      runId: 'ppt-run',
      sessionId: 'session-1',
      workspaceRootPath: tempDir,
      runSummary: '创建演示文稿'
    })
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

    const completed = await service.finishRunTracking('ppt-run')

    expect(completed).toHaveLength(1)
    expect(completed[0]?.record.id).toBe('ppt-change')
    expect(completed[0]?.record.capability).toBe('ppt')
    expect(completed[0]?.record.previewPath).toBeTruthy()
    const manifest = JSON.parse(
      await fs.readFile(completed[0]!.record.previewPath!, 'utf8')
    ) as Record<string, unknown>
    expect(manifest.version).toBe(1)
  })

  it('preserves a verified specialist change under ignored runtime assets', async () => {
    const targetPath = path.join(tempDir, '.ncurator', 'runtime', 'assets', 'bucket', 'input.docx')
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'before')
    await service.beginRunTracking({
      runId: 'attachment-run',
      sessionId: 'session-1',
      workspaceRootPath: tempDir,
      runSummary: '修改附件'
    })
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

    const completed = await service.finishRunTracking('attachment-run')

    expect(completed).toHaveLength(1)
    expect(completed[0]?.record.status).toBe('applied')
    expect(completed[0]?.record.error).toBeUndefined()
    expect((await service.getRecord({ changeId: 'attachment-change' })).record?.status).toBe(
      'applied'
    )
  })

  it('marks a specialist no-op with the user-facing no-change reason', async () => {
    const targetPath = path.join(tempDir, '.ncurator', 'runtime', 'assets', 'bucket', 'input.docx')
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'same')
    await service.beginRunTracking({
      runId: 'no-op-run',
      sessionId: 'session-1',
      workspaceRootPath: tempDir,
      runSummary: '重复写入相同内容'
    })
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

    const completed = await service.finishRunTracking('no-op-run')

    expect(completed).toHaveLength(1)
    expect(completed[0]?.record.status).toBe('failed')
    expect(completed[0]?.record.error).toBe(NO_EFFECTIVE_FILE_CHANGE_MESSAGE)
  })

  it('captures create delete and rename in one run', async () => {
    const deletedPath = path.join(tempDir, 'deleted.txt')
    const renamedBeforePath = path.join(tempDir, 'before-name.txt')
    const renamedAfterPath = path.join(tempDir, 'after-name.txt')
    await fs.writeFile(deletedPath, 'delete me')
    await fs.writeFile(renamedBeforePath, 'unique rename content')
    await service.beginRunTracking({
      runId: 'operations-run',
      sessionId: 'session-1',
      workspaceRootPath: tempDir,
      runSummary: '整理文件'
    })
    await fs.rm(deletedPath)
    await fs.rename(renamedBeforePath, renamedAfterPath)
    await fs.writeFile(path.join(tempDir, 'created.txt'), 'new file')

    const completed = await service.finishRunTracking('operations-run')
    expect(completed.map((item) => item.record.operation).sort()).toEqual([
      'created',
      'deleted',
      'renamed'
    ])
    const renamed = completed.find((item) => item.record.operation === 'renamed')?.record
    expect(renamed?.beforePath).toBe(renamedBeforePath)
    expect(renamed?.afterPath).toBe(renamedAfterPath)
    const openedRename = await service.getRecord({ changeId: renamed!.id })
    expect(openedRename.record?.previewPath).toBeUndefined()
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

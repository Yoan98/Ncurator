import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AiFileChangeRecord,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse
} from '../../../../src/shared/types'
import { AiFileChangeService } from '../../../../src/main/services/ai/fileChanges/AiFileChangeService'

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
  changeCount: input.changeCount ?? 1,
  beforeSnapshotPath: input.beforeSnapshotPath,
  beforeChecksum: input.beforeChecksum,
  afterChecksum: input.afterChecksum,
  previewPath: input.previewPath,
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

  it('deletes created files during revert', async () => {
    const targetPath = path.join(tempDir, 'created.txt')
    await fs.writeFile(targetPath, 'created')
    await store.saveRecord(
      createRecord({
        id: 'created-change',
        path: targetPath,
        operation: 'created'
      })
    )

    const response = await service.revertRecord({ changeId: 'created-change' })

    await expect(fs.access(targetPath)).rejects.toThrow()
    expect(response.success).toBe(true)
    expect(response.record?.status).toBe('reverted')
  })

  it('requires force when an updated file changed after AI write', async () => {
    const targetPath = path.join(tempDir, 'updated.txt')
    const snapshotPath = path.join(tempDir, 'updated.snapshot.txt')
    await fs.writeFile(snapshotPath, 'before')
    await fs.writeFile(targetPath, 'after')
    await store.saveRecord(
      createRecord({
        id: 'updated-change',
        path: targetPath,
        operation: 'updated',
        beforeSnapshotPath: snapshotPath,
        afterChecksum: 'not-current-checksum'
      })
    )

    const blocked = await service.revertRecord({ changeId: 'updated-change' })
    expect(blocked.success).toBe(false)
    expect(blocked.requiresForce).toBe(true)

    const forced = await service.revertRecord({ changeId: 'updated-change', force: true })
    const content = await fs.readFile(targetPath, 'utf8')
    expect(forced.success).toBe(true)
    expect(forced.record?.status).toBe('reverted')
    expect(content).toBe('before')
  })
})

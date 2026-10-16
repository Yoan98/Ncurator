import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiFileChangeRecord,
  GetAiFileChangeRecordRequest,
  ListAiFileChangeRecordsRequest,
  TextFileDiffArtifact
} from '../../../../src/shared/types'
import { AiFileChangeService } from '../../../../src/main/services/ai/fileChanges/AiFileChangeService'
import { setOfficeFileWriteListener } from '../../../../src/main/services/wps/officeFileWriteNotify'

class MemoryStore {
  public records = new Map<string, AiFileChangeRecord>()
  public async removeRecord(id: string) {
    this.records.delete(id)
  }
  public async saveRecord(record: AiFileChangeRecord) {
    this.records.set(record.id, structuredClone(record))
  }
  public async getRecord(request: GetAiFileChangeRecordRequest) {
    return { record: this.records.get(request.changeId) }
  }
  public async listRecords(request?: ListAiFileChangeRecordsRequest) {
    const items = [...this.records.values()].filter(
      (record) =>
        (!request?.runId || record.runId === request.runId) &&
        (!request?.partnerId || record.partnerId === request.partnerId)
    )
    return { items, total: items.length }
  }
}
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
describe('confirmed file sessions', () => {
  let root: string, store: MemoryStore, service: AiFileChangeService
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-session-'))
    vi.stubEnv('NCURATOR_USER_DATA_PATH', path.join(root, 'userData'))
    store = new MemoryStore()
    service = new AiFileChangeService(store)
  })
  afterEach(async () => {
    setOfficeFileWriteListener(undefined)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(root, { recursive: true, force: true })
  })
  const write = async (
    service: AiFileChangeService,
    sourcePath: string,
    content: string,
    run = 'owner'
  ) =>
    service.sessions.write('partner', run, {
      sourcePath,
      buffer: Buffer.from(content),
      capability: 'text_file'
    })

  it('publishes only the latest confirmed B and recovers an immutable review after external C', async () => {
    const source = path.join(root, 'text.md'),
      original = Buffer.from('\ufeffA\r\nunchanged\r\n')
    await fs.writeFile(source, original)
    const first = await write(service, source, 'B\nunchanged\n')
    const prior = await service.sessions.read('partner', 'owner', source)
    const second = await write(service, source, 'B2\nunchanged\n')
    expect(second.record.id).toBe(first.record.id)
    expect(await fs.readFile(first.record.beforeSnapshotPath!)).toEqual(original)
    expect(second.record.previewPath).toBeUndefined()
    await expect(fs.access(prior!.workingPath!)).rejects.toThrow()
    await fs.writeFile(source, 'C\n')
    service = new AiFileChangeService(store)
    const [record] = await service.sessions.recoverPartner('partner')
    expect(record.afterChecksum).toBe(hash(Buffer.from('B2\nunchanged\n')))
    expect(await fs.readFile(source, 'utf8')).toBe('C\n')
    const review = JSON.parse(
      await fs.readFile(record.previewPath!, 'utf8')
    ) as TextFileDiffArtifact
    expect(review).toEqual({ version: 4, before: 'A\nunchanged\n', after: 'B2\nunchanged\n' })
    expect(record.afterSnapshotPath).toBeUndefined()
    expect(await service.sessions.read('partner', 'owner', source)).toBeUndefined()
    expect((await service.sessions.finalize('partner', 'owner'))[0].previewPath).toBe(
      record.previewPath
    )
    expect((await service.revertRecord({ changeId: record.id })).requiresForce).toBe(true)
    expect((await service.revertRecord({ changeId: record.id, force: true })).success).toBe(true)
    expect(await fs.readFile(source)).toEqual(original)
  })

  it('removes zero net changes and preserves created empty files for revert', async () => {
    const source = path.join(root, 'old.txt')
    await fs.writeFile(source, 'A')
    await write(service, source, 'B')
    await write(service, source, 'A')
    expect(await service.sessions.finalize('partner', 'owner')).toEqual([])
    const empty = path.join(root, 'empty.txt')
    const created = await write(service, empty, '')
    expect((await service.sessions.finalize('partner', 'owner'))[0].operation).toBe('created')
    expect((await service.revertRecord({ changeId: created.record.id })).success).toBe(true)
    await expect(fs.access(empty)).rejects.toThrow()
  })

  it('reports pre-save failure and leaves A untouched without internal path details', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const originalWrite = fs.writeFile.bind(fs)
    const failure = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (String(args[0]).startsWith(path.join(root, '.target.txt.')))
        throw Object.assign(new Error('denied internal temp'), { code: 'EACCES' })
      return originalWrite(...args)
    })
    await expect(write(service, source, 'B')).rejects.toThrow('尚未保存')
    expect(await fs.readFile(source, 'utf8')).toBe('A')
    expect(await service.sessions.read('partner', 'owner', source)).toBeUndefined()
    failure.mockRestore()
    await fs.writeFile(source, 'C')
    const saved = await write(service, source, 'B')
    expect(saved.record.beforeChecksum).toBe(hash(Buffer.from('C')))
    expect(await fs.readFile(saved.record.beforeSnapshotPath!, 'utf8')).toBe('C')
    await write(service, source, 'C')
    expect(await service.sessions.finalize('partner', 'owner')).toEqual([])
  })

  it('does not restore the file after record failure and retains the previous confirmed review input', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const first = await write(service, source, 'B1')
    vi.spyOn(store, 'saveRecord').mockRejectedValueOnce(new Error('record save failed'))
    await expect(write(service, source, 'B2')).rejects.toThrow('已经写入')
    expect(await fs.readFile(source, 'utf8')).toBe('B2')
    expect((await service.sessions.read('partner', 'owner', source))?.record.afterChecksum).toBe(
      first.checksum
    )
    const [review] = await service.sessions.finalize('partner', 'owner')
    expect(review.afterChecksum).toBe(first.checksum)
  })

  it('rejects mismatching readback without publishing unconfirmed B', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const first = await write(service, source, 'B1')
    const originalRead = fs.readFile.bind(fs)
    let reads = 0
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (args[0] === source && ++reads === 2) return Buffer.from('unexpected')
      return originalRead(...args)
    })
    await expect(write(service, source, 'B2')).rejects.toThrow('保存校验不一致')
    expect((await service.sessions.read('partner', 'owner', source))?.record.afterChecksum).toBe(
      first.checksum
    )
    expect(await fs.readFile(source, 'utf8')).toBe('B2')
  })

  it('waits for writes before finalizing and retries failed review from persisted inputs', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const writing = write(service, source, 'B')
    const closing = service.sessions.finalize('partner', 'owner')
    const saved = await writing,
      [review] = await closing
    expect(review.afterChecksum).toBe(saved.checksum)
    const invalid = path.join(root, 'invalid.docx')
    await service.sessions.write('partner', 'broken', {
      sourcePath: invalid,
      buffer: Buffer.from('invalid'),
      capability: 'docx'
    })
    const [failed] = await service.sessions.finalize('partner', 'broken')
    expect(failed.status).toBe('applied')
    expect(failed.error).toContain('审核生成失败')
    const pending = await service.sessions.read('partner', 'broken', invalid)
    expect(await fs.readFile(pending!.workingPath!, 'utf8')).toBe('invalid')
    await fs.writeFile(invalid, 'C')
    expect(
      (await new AiFileChangeService(store).sessions.finalize('partner', 'broken'))[0].afterChecksum
    ).toBe(failed.afterChecksum)
  })

  it('keeps the previous confirmed B if snapshot publication fails after saving', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const first = await write(service, source, 'B1')
    const originalRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('pending.json'))
        throw Object.assign(new Error('pending publication denied'), { code: 'EACCES' })
      return originalRename(from, to)
    })
    await expect(write(service, source, 'B2')).rejects.toThrow('已经写入')
    expect(await fs.readFile(source, 'utf8')).toBe('B2')
    expect(store.records.get(first.record.id)?.afterChecksum).toBe(first.checksum)
    expect((await service.sessions.read('partner', 'owner', source))?.record.afterChecksum).toBe(
      first.checksum
    )
    expect((await service.sessions.finalize('partner', 'owner'))[0].afterChecksum).toBe(
      first.checksum
    )
  })

  it('preserves user revert state when retrying a failed review', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    const saved = await write(service, source, 'B')
    const originalWrite = fs.writeFile.bind(fs)
    const failure = vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('review.json'))
        throw Object.assign(new Error('review denied'), { code: 'EACCES' })
      return originalWrite(...args)
    })
    expect((await service.sessions.finalize('partner', 'owner'))[0].error).toContain('审核生成失败')
    expect((await service.revertRecord({ changeId: saved.record.id })).success).toBe(true)
    failure.mockRestore()
    const [reviewed] = await new AiFileChangeService(store).sessions.recoverPartner('partner')
    expect(reviewed.status).toBe('reverted')
    expect(reviewed.revertedAt).toBeTruthy()
    expect(await fs.readFile(source, 'utf8')).toBe('A')
    expect(JSON.parse(await fs.readFile(reviewed.previewPath!, 'utf8'))).toEqual({
      version: 4,
      before: 'A',
      after: 'B'
    })
  })

  it('keeps a completed review on cleanup failure and finishes cleanup without regenerating', async () => {
    const source = path.join(root, 'target.txt')
    await fs.writeFile(source, 'A')
    await write(service, source, 'B')
    const session = await service.sessions.read('partner', 'owner', source),
      originalRm = fs.rm.bind(fs)
    const failure = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('pending.json'))
        throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' })
      return originalRm(...args)
    })
    const [first] = await service.sessions.finalize('partner', 'owner')
    expect(first.error).toBeUndefined()
    expect(await service.sessions.read('partner', 'owner', source)).toBeTruthy()
    failure.mockRestore()
    await fs.writeFile(source, 'C')
    const [second] = await new AiFileChangeService(store).sessions.recoverPartner('partner')
    expect(second.previewPath).toBe(first.previewPath)
    expect(await service.sessions.read('partner', 'owner', source)).toBeUndefined()
    await expect(fs.access(session!.workingPath!)).rejects.toThrow()
  })

  it('reverts two runs in reverse order using exact original bytes', async () => {
    const source = path.join(root, 'target.txt'),
      A = Buffer.from('\ufeffA\r\n')
    await fs.writeFile(source, A)
    const b = await write(service, source, 'B', 'first')
    await service.sessions.finalize('partner', 'first')
    const c = await write(service, source, 'C', 'second')
    await service.sessions.finalize('partner', 'second')
    expect((await service.revertRecord({ changeId: c.record.id })).success).toBe(true)
    expect(await fs.readFile(source, 'utf8')).toBe('B')
    expect((await service.revertRecord({ changeId: b.record.id })).success).toBe(true)
    expect(await fs.readFile(source)).toEqual(A)
  })

  it.each([false, true])(
    'notifies each reverted Office path once (renamed=%s)',
    async (renamed) => {
      const original = path.join(root, 'before.xlsx'),
        current = renamed ? path.join(root, 'after.xlsx') : original,
        snapshot = path.join(root, 'snapshot.bin'),
        notifyWritten = vi.fn<(filePath: string) => void>()
      await fs.writeFile(current, 'B')
      await fs.writeFile(snapshot, 'A')
      const record: AiFileChangeRecord = {
        id: 'office-revert',
        partnerId: 'partner',
        runId: 'run',
        status: 'applied',
        capability: 'excel',
        path: original,
        fileName: path.basename(original),
        operation: renamed ? 'renamed' : 'updated',
        source: 'excel_tool',
        beforePath: original,
        afterPath: current,
        beforeSnapshotPath: snapshot,
        afterChecksum: hash(Buffer.from('B')),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      await service.saveRecord(record)
      setOfficeFileWriteListener({ notifyWritten })
      expect((await service.revertRecord({ changeId: record.id })).success).toBe(true)
      expect(await fs.readFile(original, 'utf8')).toBe('A')
      expect(notifyWritten.mock.calls.map(([filePath]) => filePath)).toEqual(
        renamed ? [current, original] : [original]
      )
    }
  )
})

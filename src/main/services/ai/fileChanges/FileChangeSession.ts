import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { AiFileChangeCapability, AiFileChangeRecord } from '../../../../shared/types'
import { getPartnerRuntimeDir } from '../../assets/WorkspaceAssetService'
import { notifyOfficeFileWritten, withOfficeFileWrite } from '../../wps/officeFileWriteNotify'
import { getFileChangeDirectory, saveFileChangeSnapshot } from './FileChangeSnapshots'
import type { AiFileChangeRecordStore } from './AiFileChangeService'

export type ExcelSheetAxes = { sheet: string; rows: (number | null)[]; columns: (number | null)[] }
export type FileChangeIdentity =
  | {
      kind: 'ppt'
      movedSlides: string[]
      replacedSlides: string[]
      movedElements: string[]
      elementLineage: [string, string][]
    }
  | { kind: 'excel'; sheets: [string, string | null][]; axes: ExcelSheetAxes[] }

export type FileChangeSession = {
  version: 1
  record: AiFileChangeRecord
  workingPath?: string
  identity?: FileChangeIdentity
}
export type FileChangeWrite = {
  sourcePath: string
  buffer: Buffer
  capability: AiFileChangeCapability
  identity?: FileChangeIdentity
  expectedChecksum?: string
  created?: boolean
}
export type ConfirmedFileWrite = {
  checksum: string
  byteSize: number
  modifiedAt: number
  record: AiFileChangeRecord
}
const hash = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')
const exists = async (file: string): Promise<boolean> =>
  fs
    .access(file)
    .then(() => true)
    .catch(() => false)
const isMissing = (error: Error): boolean => 'code' in error && error.code === 'ENOENT'
const readDirectories = async (dir: string) =>
  fs.readdir(dir, { withFileTypes: true }).catch((error: Error) => {
    if (isMissing(error)) return []
    throw error
  })

export class FileChangeSessions {
  private readonly writes = new Map<string, Promise<ConfirmedFileWrite>>()
  private readonly finalizations = new Map<string, Promise<AiFileChangeRecord[]>>()
  public constructor(private readonly store: AiFileChangeRecordStore) {}

  private root(partnerId: string, ownerRunId: string): string {
    return path.join(getPartnerRuntimeDir(partnerId), 'file-changes', ownerRunId)
  }
  public async read(
    partnerId: string,
    ownerRunId: string,
    sourcePath: string
  ): Promise<FileChangeSession | undefined> {
    const root = this.root(partnerId, ownerRunId)
    const entries = await readDirectories(root)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pending = path.join(root, entry.name, 'pending.json')
      if (!(await exists(pending))) continue
      const session = JSON.parse(await fs.readFile(pending, 'utf8')) as FileChangeSession
      if (session.version !== 1) throw new Error('不支持的文件会话版本')
      if (session.record.path === path.resolve(sourcePath)) return session
    }
    return undefined
  }

  public async write(
    partnerId: string,
    ownerRunId: string,
    input: FileChangeWrite
  ): Promise<ConfirmedFileWrite> {
    const sourcePath = path.resolve(input.sourcePath)
    const key = `${partnerId}\0${ownerRunId}\0${sourcePath}`
    const previous = this.writes.get(key)
    const writing = (async () => {
      await previous?.catch(() => undefined)
      return await this.publish(partnerId, ownerRunId, { ...input, sourcePath })
    })()
    this.writes.set(key, writing)
    try {
      return await writing
    } finally {
      if (this.writes.get(key) === writing) this.writes.delete(key)
    }
  }

  private async publish(
    partnerId: string,
    runId: string,
    input: FileChangeWrite
  ): Promise<ConfirmedFileWrite> {
    let stage = 'session'
    let written = false
    let attempted = false
    let sourceTemp: string | undefined
    let workingPath: string | undefined
    let pendingDir: string | undefined
    let previous: FileChangeSession | undefined
    let recordSaved = false
    try {
      previous = await this.read(partnerId, runId, input.sourcePath)
      stage = 'baseline'
      const before = await fs.readFile(input.sourcePath).catch((error: Error) => {
        if (isMissing(error)) return undefined
        throw error
      })
      if (input.created && before) throw new Error('目标文件已经存在')
      if (input.expectedChecksum && (!before || hash(before) !== input.expectedChecksum))
        throw new Error('文件在操作期间发生变化，请重新读取后再修改')
      const mode = before ? (await fs.stat(input.sourcePath)).mode : 0o644
      const changeId = previous?.record.id || randomUUID()
      const dir = getFileChangeDirectory(partnerId, runId, changeId)
      const baseline =
        !previous && before
          ? await saveFileChangeSnapshot(
              dir,
              `before${path.extname(input.sourcePath) || '.bin'}`,
              before
            )
          : undefined
      const now = Date.now()
      const record: AiFileChangeRecord = previous?.record || {
        id: changeId,
        partnerId,
        runId,
        status: 'applied',
        capability: input.capability,
        path: input.sourcePath,
        fileName: path.basename(input.sourcePath),
        operation: before ? 'updated' : 'created',
        source: input.capability === 'text_file' ? 'text_tool' : `${input.capability}_tool`,
        beforePath: before ? input.sourcePath : undefined,
        afterPath: input.sourcePath,
        beforeSnapshotPath: baseline?.snapshotPath,
        beforeObjectHash: baseline?.hash,
        beforeChecksum: baseline?.hash,
        changeCount: 0,
        insertCount: 0,
        deleteCount: 0,
        createdAt: now,
        updatedAt: now
      }
      await fs.mkdir(dir, { recursive: true })
      // Even an interrupted first write retains A; no unconfirmed B is published.
      stage = 'session'
      if (!previous) {
        pendingDir = dir
        await this.savePending(dir, { version: 1, record })
      }
      stage = 'save'
      await fs.mkdir(path.dirname(input.sourcePath), { recursive: true })
      sourceTemp = path.join(
        path.dirname(input.sourcePath),
        `.${path.basename(input.sourcePath)}.${randomUUID()}.tmp`
      )
      await withOfficeFileWrite(input.sourcePath, async () => {
        await fs.writeFile(sourceTemp!, input.buffer, { flag: 'wx', mode })
        await fs.chmod(sourceTemp!, mode)
        attempted = true
        await fs.rename(sourceTemp!, input.sourcePath)
        written = true
        notifyOfficeFileWritten(input.sourcePath)
        stage = 'verify'
        const actual = await fs.readFile(input.sourcePath)
        if (!actual.equals(input.buffer))
          throw new Error('保存校验不一致，请重新读取文件确认实际内容')
      })
      const stat = await fs.stat(input.sourcePath)
      stage = 'snapshot'
      workingPath = path.join(dir, `working-${randomUUID()}${path.extname(input.sourcePath)}`)
      await fs.writeFile(workingPath, input.buffer, { flag: 'wx' })
      const imageSnapshot =
        input.capability === 'image'
          ? await saveFileChangeSnapshot(
              dir,
              `after-${hash(input.buffer)}${path.extname(input.sourcePath) || '.bin'}`,
              input.buffer
            )
          : undefined
      const nextRecord = {
        ...record,
        afterChecksum: hash(input.buffer),
        updatedAt: now,
        error: undefined,
        afterSnapshotPath: imageSnapshot?.snapshotPath,
        afterObjectHash: imageSnapshot?.hash,
        changeCount: input.capability === 'image' ? 1 : 0
      }
      stage = 'record'
      await this.store.saveRecord(nextRecord)
      recordSaved = true
      await this.savePending(dir, {
        version: 1,
        record: nextRecord,
        workingPath,
        identity: input.identity
      })
      if (previous?.workingPath)
        await fs.rm(previous.workingPath, { force: true }).catch(() => undefined)
      return {
        checksum: nextRecord.afterChecksum,
        byteSize: input.buffer.length,
        modifiedAt: Math.trunc(stat.mtimeMs),
        record: nextRecord
      }
    } catch (cause) {
      console.error('[FILE-WRITE]', { stage, sourcePath: input.sourcePath, cause })
      if (recordSaved) {
        if (previous?.workingPath) await this.store.saveRecord(previous.record).catch(console.error)
        else {
          const pending = await this.read(partnerId, runId, input.sourcePath).catch(() => undefined)
          if (pending) await this.store.removeRecord(pending.record.id).catch(console.error)
        }
      }
      if (workingPath) await fs.rm(workingPath, { force: true }).catch(() => undefined)
      // A belongs to the first attempted publication, not an edit that never reached the file.
      if (pendingDir && !attempted) {
        await fs.rm(pendingDir, { recursive: true, force: true }).catch(console.error)
      }
      const error = cause instanceof Error ? cause : new Error(String(cause))
      const code = 'code' in error ? String(error.code) : ''
      const reasons: Record<string, string> = {
        EACCES: '没有文件写入权限',
        EPERM: '文件被占用或没有写入权限',
        EBUSY: '文件被占用',
        ENOSPC: '磁盘空间不足',
        ENOTDIR: '目标位置不是文件夹',
        EISDIR: '目标是文件夹',
        EROFS: '目标位置只读',
        ENOENT: '目标位置不存在'
      }
      const detail = error.message
        .replace(/(?:[A-Za-z]:)?[\\/]\S+/g, '文件位置')
        .replace(/rename|temporary|temp/gi, '保存')
      const internal =
        !code &&
        (stage === 'session' || stage === 'save' || stage === 'snapshot' || stage === 'record')
      const reason =
        reasons[code] ||
        `${internal ? '内部程序错误：' : ''}${detail}${internal ? '；请反馈作者修复' : ''}`
      const state = written
        ? '文件已经写入，但后续处理失败。请重新读取文件后决定下一步。'
        : attempted
          ? '无法确认实际文件状态，请重新读取文件。'
          : '本次尚未保存。'
      throw new Error(`文件修改失败：${reason}。${state}`)
    } finally {
      if (sourceTemp) await fs.rm(sourceTemp, { force: true }).catch(() => undefined)
    }
  }
  private async savePending(dir: string, session: FileChangeSession): Promise<void> {
    const temp = path.join(dir, `pending-${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temp, JSON.stringify(session), { flag: 'wx' })
      await fs.rename(temp, path.join(dir, 'pending.json'))
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined)
    }
  }

  public async recoverPartner(partnerId: string): Promise<AiFileChangeRecord[]> {
    const root = path.join(getPartnerRuntimeDir(partnerId), 'file-changes')
    const runs = await readDirectories(root)
    const records: AiFileChangeRecord[] = []
    for (const run of runs) {
      if (!run.isDirectory()) continue
      const changes = await fs.readdir(path.join(root, run.name), { withFileTypes: true })
      const hasPending = (
        await Promise.all(
          changes
            .filter((change) => change.isDirectory())
            .map((change) => exists(path.join(root, run.name, change.name, 'pending.json')))
        )
      ).some(Boolean)
      if (hasPending) records.push(...(await this.finalize(partnerId, run.name)))
    }
    return records
  }

  public async finalize(partnerId: string, ownerRunId: string): Promise<AiFileChangeRecord[]> {
    const key = `${partnerId}\0${ownerRunId}`
    const current = this.finalizations.get(key)
    if (current) return await current
    const finalizing = this.finish(partnerId, ownerRunId)
    this.finalizations.set(key, finalizing)
    try {
      return await finalizing
    } finally {
      this.finalizations.delete(key)
    }
  }
  private async finish(partnerId: string, ownerRunId: string): Promise<AiFileChangeRecord[]> {
    await Promise.allSettled(
      [...this.writes]
        .filter(([key]) => key.startsWith(`${partnerId}\0${ownerRunId}\0`))
        .map(([, value]) => value)
    )
    const root = this.root(partnerId, ownerRunId)
    const entries = await readDirectories(root)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name),
        pending = path.join(dir, 'pending.json')
      if (!(await exists(pending))) continue
      let session: FileChangeSession
      try {
        session = JSON.parse(await fs.readFile(pending, 'utf8')) as FileChangeSession
        if (session.version !== 1 || session.record?.id !== entry.name)
          throw new Error('无效的文件会话记录')
      } catch (error) {
        console.error('[FILE-REVIEW-SESSION]', { ownerRunId, changeId: entry.name, error })
        const stored = (await this.store.getRecord({ changeId: entry.name })).record
        if (stored && !stored.previewPath)
          await this.store
            .saveRecord({
              ...stored,
              error: '文件已保存，审核会话无法读取。',
              updatedAt: Date.now()
            })
            .catch(console.error)
        continue
      }
      if (!session.workingPath) {
        await fs.rm(pending).catch(console.error)
        continue
      }
      let reviewDir: string | undefined
      let saved = false
      try {
        const completed = (await this.store.getRecord({ changeId: session.record.id })).record
        if (completed?.previewPath && !completed.error) saved = true
        else {
          const before = session.record.beforeSnapshotPath
            ? await fs.readFile(session.record.beforeSnapshotPath)
            : undefined
          const after = await fs.readFile(session.workingPath)
          if (before && hash(before) !== session.record.beforeChecksum)
            throw new Error('原始版本校验不一致')
          if (hash(after) !== session.record.afterChecksum)
            throw new Error('确认工作版本校验不一致')
          reviewDir = path.join(dir, 'review', randomUUID())
          await fs.mkdir(reviewDir, { recursive: true })
          const { materializeFileReview } = await import('./materializeFileReview')
          const { changed, ...artifact } = await materializeFileReview({
            before,
            after,
            session,
            reviewDir
          })
          if (!changed && session.record.operation !== 'created') {
            await this.store.removeRecord(session.record.id)
            await fs.rm(dir, { recursive: true, force: true })
            continue
          } else {
            await this.store.saveRecord({
              ...session.record,
              ...artifact,
              status: completed?.status || 'applied',
              revertedAt: completed?.revertedAt,
              runSummary: completed?.runSummary || session.record.runSummary,
              error: undefined,
              afterSnapshotPath:
                session.record.capability === 'image'
                  ? session.record.afterSnapshotPath
                  : undefined,
              afterObjectHash:
                session.record.capability === 'image' ? session.record.afterObjectHash : undefined,
              updatedAt: Date.now()
            })
          }
          saved = true
        }
      } catch (error) {
        console.error('[FILE-REVIEW]', { ownerRunId, changeId: session.record.id, error })
        if (reviewDir) await fs.rm(reviewDir, { recursive: true, force: true }).catch(console.error)
        const current = (
          await this.store
            .getRecord({ changeId: session.record.id })
            .catch(() => ({ record: undefined }))
        ).record
        await this.store
          .saveRecord({
            ...session.record,
            status: current?.status || 'applied',
            revertedAt: current?.revertedAt,
            error: '文件已保存，审核生成失败。',
            updatedAt: Date.now()
          })
          .catch(console.error)
      }
      if (saved) {
        // Cleanup errors never downgrade a completed immutable review. A retry can finish cleanup.
        try {
          const files = await fs.readdir(dir)
          for (const file of files)
            if (file.startsWith('working-')) await fs.rm(path.join(dir, file), { force: true })
          await fs.rm(pending, { force: true })
        } catch (error) {
          console.error('[FILE-REVIEW-CLEANUP]', { ownerRunId, changeId: session.record.id, error })
        }
      }
    }
    return (await this.store.listRecords({ runId: ownerRunId })).items
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AiFileChangeRecord,
  GetAiFileChangeRecordRequest,
  GetAiFileChangeRecordResponse,
  ListAiFileChangeRecordsRequest,
  ListAiFileChangeRecordsResponse,
  RevertAiFileChangeRequest,
  RevertAiFileChangeResponse
} from '../../../../shared/types'
import { calculateFileStats, fileExists } from '../human/tools/docx/review/utils'
import { FileChangeSessions } from './FileChangeSession'
import {
  normalizeOfficePath,
  notifyOfficeFileWritten,
  withOfficeFileWrite
} from '../../wps/officeFileWriteNotify'

const FORCE_REVERT_WARNING =
  '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'

export interface AiFileChangeRecordStore {
  removeRecord(id: string): Promise<void>
  saveRecord(record: AiFileChangeRecord): Promise<void>
  listRecords(request?: ListAiFileChangeRecordsRequest): Promise<ListAiFileChangeRecordsResponse>
  getRecord(request: GetAiFileChangeRecordRequest): Promise<GetAiFileChangeRecordResponse>
}

export class AiFileChangeService {
  public constructor(private readonly store: AiFileChangeRecordStore) {
    this.sessions = new FileChangeSessions(store)
  }

  public async removeRecord(id: string): Promise<void> {
    await this.store.removeRecord(id)
  }

  public readonly sessions: FileChangeSessions

  public async saveRecord(record: AiFileChangeRecord): Promise<void> {
    // Content tools pass confirmed versions. Never infer B from a mutable source.
    await this.store.saveRecord(record)
  }

  public async listRecords(
    request?: ListAiFileChangeRecordsRequest
  ): Promise<ListAiFileChangeRecordsResponse> {
    return await this.store.listRecords(request)
  }

  public async getRecord(
    request: GetAiFileChangeRecordRequest
  ): Promise<GetAiFileChangeRecordResponse> {
    return await this.store.getRecord(request)
  }

  public async revertRecord(
    request: RevertAiFileChangeRequest
  ): Promise<RevertAiFileChangeResponse> {
    const response = await this.store.getRecord({ changeId: request.changeId })
    const record = response.record
    if (!record) return { success: false, error: response.error || 'file change record not found' }
    if (record.status !== 'applied') {
      return { success: false, record, error: 'current file change record cannot be reverted' }
    }

    const currentPath = record.afterPath || record.path
    const matchesExpected = async () => {
      if (request.force) return true
      const exists = await fileExists(currentPath)
      if (exists !== (record.operation !== 'deleted')) return false
      return (
        !exists ||
        !record.afterChecksum ||
        (await calculateFileStats(currentPath)).checksum === record.afterChecksum
      )
    }
    const updatedAt = Date.now()
    try {
      const restorePath =
        record.operation === 'created' ? currentPath : record.beforePath || record.path
      const applyRevert = async (): Promise<boolean> => {
        if (!(await matchesExpected())) return false
        if (record.operation === 'created') {
          await fs.rm(currentPath, { force: true })
        } else {
          if (!record.beforeSnapshotPath) throw new Error('checkpoint snapshot is missing')
          if (record.operation === 'renamed' && currentPath !== restorePath) {
            await fs.rm(currentPath, { force: true })
          }
          await fs.mkdir(path.dirname(restorePath), { recursive: true })
          const tempOutputPath = path.join(
            path.dirname(restorePath),
            `${path.basename(restorePath)}.revert-${record.id}.tmp`
          )
          await fs.copyFile(record.beforeSnapshotPath, tempOutputPath)
          await fs.rename(tempOutputPath, restorePath)
        }
        notifyOfficeFileWritten(currentPath)
        if (record.operation !== 'created' && restorePath !== currentPath) {
          notifyOfficeFileWritten(restorePath)
        }
        return true
      }
      const [first, second] = [currentPath, restorePath].sort((a, b) =>
        normalizeOfficePath(a).localeCompare(normalizeOfficePath(b))
      )
      const applied = await withOfficeFileWrite(first!, () =>
        normalizeOfficePath(first!) === normalizeOfficePath(second!)
          ? applyRevert()
          : withOfficeFileWrite(second!, applyRevert)
      )
      if (!applied)
        return { success: false, record, requiresForce: true, warning: FORCE_REVERT_WARNING }

      const reverted: AiFileChangeRecord = {
        ...record,
        status: 'reverted',
        updatedAt,
        revertedAt: updatedAt,
        error: undefined
      }
      await this.store.saveRecord(reverted)
      return { success: true, record: reverted }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: AiFileChangeRecord = {
        ...record,
        status: 'failed',
        updatedAt,
        error: message
      }
      await this.store.saveRecord(failed)
      return { success: false, record: failed, error: message }
    }
  }
}

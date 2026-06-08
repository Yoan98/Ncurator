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

const FORCE_REVERT_WARNING =
  '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'

export interface AiFileChangeRecordStore {
  saveRecord(record: AiFileChangeRecord): Promise<void>
  listRecords(request?: ListAiFileChangeRecordsRequest): Promise<ListAiFileChangeRecordsResponse>
  getRecord(request: GetAiFileChangeRecordRequest): Promise<GetAiFileChangeRecordResponse>
}

export class AiFileChangeService {
  public constructor(private readonly store: AiFileChangeRecordStore) {}

  public async saveRecord(record: AiFileChangeRecord): Promise<void> {
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

    const sourceExists = await fileExists(record.path)
    if (!sourceExists) {
      if (!request.force) {
        return { success: false, record, requiresForce: true, warning: FORCE_REVERT_WARNING }
      }
    } else if (record.afterChecksum) {
      const currentStats = await calculateFileStats(record.path)
      if (currentStats.checksum !== record.afterChecksum && !request.force) {
        return { success: false, record, requiresForce: true, warning: FORCE_REVERT_WARNING }
      }
    }

    const updatedAt = Date.now()
    try {
      if (record.operation === 'created') {
        await fs.rm(record.path, { force: true })
      } else {
        if (!record.beforeSnapshotPath) throw new Error('checkpoint snapshot is missing')
        await fs.mkdir(path.dirname(record.path), { recursive: true })
        const tempOutputPath = path.join(
          path.dirname(record.path),
          `${path.basename(record.path)}.revert-${record.id}.tmp`
        )
        await fs.copyFile(record.beforeSnapshotPath, tempOutputPath)
        await fs.rename(tempOutputPath, record.path)
      }

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

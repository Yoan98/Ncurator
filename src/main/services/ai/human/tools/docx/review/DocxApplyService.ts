import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  DocxApplyRecord,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse,
  RevertDocxApplyRequest,
  RevertDocxApplyResponse
} from '../../../../../../../shared/types'
import type { AiFileChangeService } from '../../../../fileChanges/AiFileChangeService'
import type { DocxApplyStore } from '../../../../../storage/domains/DocxApplyStore'
import { toAiFileChangeRecordFromDocxApply } from '../../../../utils/artifacts'
import { RunDocxEditTracker } from './RunDocxEditTracker'
import type { ResolvedDocxOpenTarget } from './types'
import { calculateFileStats, fileExists } from './utils'
import { notifyOfficeFileWritten } from '../../../../../wps/officeFileWriteNotify'

const FORCE_REVERT_WARNING =
  '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'

export class DocxApplyService {
  private readonly editTracker: RunDocxEditTracker

  public constructor(
    private readonly docxApplyStore: DocxApplyStore,
    private readonly aiFileChangeService?: AiFileChangeService
  ) {
    this.editTracker = new RunDocxEditTracker(docxApplyStore)
  }

  public beginRun(input: { runId: string; partnerId: string; inputText: string }): void {
    this.editTracker.beginRun(input)
  }

  public discardRun(runId: string): void {
    this.editTracker.discardRun(runId)
  }

  public registerDocxOpen(input: Parameters<RunDocxEditTracker['registerDocxOpen']>[0]): void {
    this.editTracker.registerDocxOpen(input)
  }

  public registerDocxChanges(
    input: Parameters<RunDocxEditTracker['registerDocxChanges']>[0]
  ): void {
    this.editTracker.registerDocxChanges(input)
  }

  public async applyRunEdits(input: {
    runId: string
    partnerId: string
  }): Promise<DocxApplyRecord[]> {
    const records = await this.editTracker.applyRunEdits(input)
    await Promise.all(records.map((record) => this.saveAiFileChangeRecord(record)))
    return records
  }

  public async listRecords(
    request?: ListDocxApplyRecordsRequest
  ): Promise<ListDocxApplyRecordsResponse> {
    return await this.docxApplyStore.listRecords(request)
  }

  public async getRecord(request: GetDocxApplyRecordRequest): Promise<GetDocxApplyRecordResponse> {
    const record = await this.docxApplyStore.getRecord(request.applyId)
    return record ? { record } : { error: 'docx apply record not found' }
  }

  public async revertRecord(request: RevertDocxApplyRequest): Promise<RevertDocxApplyResponse> {
    const record = await this.docxApplyStore.getRecord(request.applyId)
    if (!record) return { success: false, error: 'docx apply record not found' }
    if (record.status !== 'applied') {
      return { success: false, record, error: 'current docx apply record cannot be reverted' }
    }

    const sourceExists = await fileExists(record.source_path)
    if (!sourceExists) {
      if (!request.force) {
        return {
          success: false,
          record,
          requiresForce: true,
          warning: FORCE_REVERT_WARNING
        }
      }
    } else if (record.after_checksum) {
      const currentStats = await calculateFileStats(record.source_path)
      if (currentStats.checksum !== record.after_checksum && !request.force) {
        return {
          success: false,
          record,
          requiresForce: true,
          warning: FORCE_REVERT_WARNING
        }
      }
    }

    const updatedAt = Date.now()
    try {
      if (record.operation === 'created') {
        await fs.rm(record.source_path, { force: true })
      } else {
        if (!record.before_snapshot_path) {
          throw new Error('checkpoint snapshot is missing')
        }
        await fs.mkdir(path.dirname(record.source_path), { recursive: true })
        const tempOutputPath = path.join(
          path.dirname(record.source_path),
          `${path.basename(record.source_path)}.revert-${record.id}.tmp`
        )
        await fs.copyFile(record.before_snapshot_path, tempOutputPath)
        await fs.rename(tempOutputPath, record.source_path)
      }

      notifyOfficeFileWritten(record.source_path)

      const reverted: DocxApplyRecord = {
        ...record,
        status: 'reverted',
        updated_at: updatedAt,
        reverted_at: updatedAt,
        error: undefined
      }
      await this.docxApplyStore.saveRecord(reverted)
      await this.saveAiFileChangeRecord(reverted)
      return { success: true, record: reverted }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: DocxApplyRecord = {
        ...record,
        status: 'failed',
        updated_at: updatedAt,
        error: message
      }
      await this.docxApplyStore.saveRecord(failed)
      await this.saveAiFileChangeRecord(failed)
      return { success: false, record: failed, error: message }
    }
  }

  private async saveAiFileChangeRecord(record: DocxApplyRecord): Promise<void> {
    if (!this.aiFileChangeService) return
    const projected = toAiFileChangeRecordFromDocxApply(record)
    const existing = await this.aiFileChangeService.getRecord({ changeId: record.id })
    await this.aiFileChangeService.saveRecord(
      existing.record
        ? {
            ...projected,
            ...existing.record,
            status: projected.status,
            updatedAt: projected.updatedAt,
            revertedAt: projected.revertedAt,
            error: projected.error
          }
        : projected
    )
  }

  public async resolveDocxOpenTarget(sourcePath: string): Promise<ResolvedDocxOpenTarget> {
    return {
      openPath: sourcePath,
      trackedSourcePath: sourcePath
    }
  }
}

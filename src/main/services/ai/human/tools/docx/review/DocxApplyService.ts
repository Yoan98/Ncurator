import type {
  AiFileChangeRecord,
  DocxApplyRecord,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse,
  RevertDocxApplyRequest,
  RevertDocxApplyResponse
} from '../../../../../../../shared/types'
import type { AiFileChangeService } from '../../../../fileChanges/AiFileChangeService'
import { calculateFileStats } from './utils'

/** Word IPC is a projection of the common record and revert service. */
export class DocxApplyService {
  public constructor(public readonly fileChanges: AiFileChangeService) {}
  private async project(record: AiFileChangeRecord): Promise<DocxApplyRecord> {
    const preview = record.previewPath
      ? await calculateFileStats(record.previewPath).catch(() => undefined)
      : undefined
    return {
      id: record.id,
      partner_id: record.partnerId,
      run_id: record.runId,
      status: record.status,
      source_path: record.path,
      source_name: record.fileName,
      operation: record.operation,
      final_revision_ref: record.afterChecksum || '',
      change_count: record.changeCount,
      insert_count: record.insertCount,
      delete_count: record.deleteCount,
      before_exists: record.operation !== 'created',
      before_snapshot_path: record.beforeSnapshotPath,
      before_checksum: record.beforeChecksum,
      after_checksum: record.afterChecksum,
      preview_diff_artifact_path: record.previewPath || '',
      preview_diff_checksum: preview?.checksum || '',
      preview_diff_byte_size: preview?.byteSize || 0,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      reverted_at: record.revertedAt,
      error: record.error
    }
  }
  public async listRecords(
    request?: ListDocxApplyRecordsRequest
  ): Promise<ListDocxApplyRecordsResponse> {
    const records = (await this.fileChanges.listRecords(request)).items.filter(
      (record) => record.capability === 'docx'
    )
    return {
      items: await Promise.all(records.map((record) => this.project(record))),
      total: records.length
    }
  }
  public async getRecord(request: GetDocxApplyRecordRequest): Promise<GetDocxApplyRecordResponse> {
    const result = await this.fileChanges.getRecord({ changeId: request.applyId })
    return result.record?.capability === 'docx'
      ? { record: await this.project(result.record) }
      : { error: 'docx apply record not found' }
  }
  public async revertRecord(request: RevertDocxApplyRequest): Promise<RevertDocxApplyResponse> {
    const result = await this.fileChanges.revertRecord({
      changeId: request.applyId,
      force: request.force
    })
    return { ...result, record: result.record ? await this.project(result.record) : undefined }
  }
  public async resolveDocxOpenTarget(
    sourcePath: string
  ): Promise<{ openPath: string; trackedSourcePath: string }> {
    return { openPath: sourcePath, trackedSourcePath: sourcePath }
  }
}

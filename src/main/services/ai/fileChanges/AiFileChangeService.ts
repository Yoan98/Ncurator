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
import {
  countTextFileDiffLines,
  createTextFileDiffArtifact
} from '../human/tools/textFile/textDiff'
import { decodeTextFile } from '../human/tools/textFile/textFileUtils'
import {
  WorkspaceChangeTracker,
  WorkspaceObjectStore,
  type CompletedWorkspaceChange
} from './WorkspaceChangeTracker'

const FORCE_REVERT_WARNING =
  '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'

export interface AiFileChangeRecordStore {
  saveRecord(record: AiFileChangeRecord): Promise<void>
  listRecords(request?: ListAiFileChangeRecordsRequest): Promise<ListAiFileChangeRecordsResponse>
  getRecord(request: GetAiFileChangeRecordRequest): Promise<GetAiFileChangeRecordResponse>
}

export class AiFileChangeService {
  private readonly workspaceChangeTracker = new WorkspaceChangeTracker()

  public constructor(private readonly store: AiFileChangeRecordStore) {}

  public async beginRunTracking(input: {
    runId: string
    sessionId: string
    workspaceRootPath: string
    runSummary: string
  }): Promise<void> {
    await this.workspaceChangeTracker.beginRun(input)
  }

  public discardRunTracking(runId: string): void {
    this.workspaceChangeTracker.discardRun(runId)
  }

  public async finishRunTracking(runId: string): Promise<CompletedWorkspaceChange[]> {
    const existingRecords = (await this.store.listRecords({ runId })).items
    const completed = await this.workspaceChangeTracker.finishRun({ runId, existingRecords })
    await Promise.all(completed.map(({ record }) => this.store.saveRecord(record)))
    return completed
  }

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
    const response = await this.store.getRecord(request)
    if (!response.record || response.record.capability !== 'text_file') return response
    if (response.record.previewPath) return response
    try {
      return { record: await this.materializeTextPreview(response.record) }
    } catch (error) {
      return {
        record: response.record,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async materializeTextPreview(record: AiFileChangeRecord): Promise<AiFileChangeRecord> {
    const beforeBuffer = record.beforeSnapshotPath
      ? await fs.readFile(record.beforeSnapshotPath)
      : Buffer.alloc(0)
    const afterBuffer = record.afterSnapshotPath
      ? await fs.readFile(record.afterSnapshotPath)
      : Buffer.alloc(0)
    const before = beforeBuffer.length
      ? decodeTextFile(beforeBuffer, record.beforePath || record.path).normalizedContent
      : ''
    const after = afterBuffer.length
      ? decodeTextFile(afterBuffer, record.afterPath || record.path).normalizedContent
      : ''
    const artifact = createTextFileDiffArtifact({ before, after })
    const counts = countTextFileDiffLines(artifact)
    const objectReference = record.afterSnapshotPath || record.beforeSnapshotPath
    if (!objectReference) throw new Error('文件修改对象不存在')
    const marker = `${path.sep}.ncurator${path.sep}objects${path.sep}`
    const markerIndex = objectReference.indexOf(marker)
    if (markerIndex < 0) throw new Error('文件修改对象路径无效')
    const workspaceRootPath = objectReference.slice(0, markerIndex)
    const previewObject = await new WorkspaceObjectStore(workspaceRootPath).putBuffer(
      Buffer.from(`${JSON.stringify(artifact)}\n`, 'utf-8')
    )
    const updated: AiFileChangeRecord = {
      ...record,
      insertCount: counts.insertCount,
      deleteCount: counts.deleteCount,
      changeCount: Math.max(1, counts.insertCount + counts.deleteCount),
      previewPath: previewObject.objectPath,
      previewArtifactHash: previewObject.hash,
      updatedAt: Date.now()
    }
    await this.store.saveRecord(updated)
    return updated
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
    const sourceExists = await fileExists(currentPath)
    const shouldExist = record.operation !== 'deleted'
    if (sourceExists !== shouldExist && !request.force) {
      return { success: false, record, requiresForce: true, warning: FORCE_REVERT_WARNING }
    }
    if (sourceExists && record.afterChecksum) {
      const currentStats = await calculateFileStats(currentPath)
      if (currentStats.checksum !== record.afterChecksum && !request.force) {
        return { success: false, record, requiresForce: true, warning: FORCE_REVERT_WARNING }
      }
    }

    const updatedAt = Date.now()
    try {
      if (record.operation === 'created') {
        await fs.rm(currentPath, { force: true })
      } else {
        if (!record.beforeSnapshotPath) throw new Error('checkpoint snapshot is missing')
        const restorePath = record.beforePath || record.path
        if (record.operation === 'renamed' && currentPath !== restorePath) {
          await fs.rm(currentPath, { force: true })
        }
        await fs.mkdir(path.dirname(restorePath), { recursive: true })
        const tempOutputPath = path.join(
          path.dirname(restorePath),
          `${path.basename(restorePath)}.revert-${record.id}.tmp`
        )
        await fs.copyFile(record.beforeSnapshotPath, tempOutputPath)
        await fs.rm(restorePath, { force: true })
        await fs.rename(tempOutputPath, restorePath)
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

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
  TerminalCommandChangeTracker,
  WorkspaceObjectStore,
} from './WorkspaceChangeTracker'
import { NO_EFFECTIVE_FILE_CHANGE_MESSAGE } from '../../../../shared/constants'

const FORCE_REVERT_WARNING =
  '当前文件在这次 AI 修改后又发生了变化。继续操作会恢复到这次修改前的版本，并丢失之后的修改。'

export interface AiFileChangeRecordStore {
  saveRecord(record: AiFileChangeRecord): Promise<void>
  listRecords(request?: ListAiFileChangeRecordsRequest): Promise<ListAiFileChangeRecordsResponse>
  getRecord(request: GetAiFileChangeRecordRequest): Promise<GetAiFileChangeRecordResponse>
}

export class AiFileChangeService {
  private readonly terminalCommandChangeTracker = new TerminalCommandChangeTracker()

  public constructor(private readonly store: AiFileChangeRecordStore) {}

  public async beginTerminalCommandTracking(input: {
    commandId: string
    runId: string
    sessionId: string
    workspaceRootPath: string
    command: string
  }): Promise<void> {
    await this.terminalCommandChangeTracker.beginCommand(input)
  }

  public discardTerminalCommandTracking(commandId: string): void {
    this.terminalCommandChangeTracker.discardCommand(commandId)
  }

  public async finishTerminalCommandTracking(commandId: string): Promise<AiFileChangeRecord[]> {
    const records = await this.terminalCommandChangeTracker.finishCommand(commandId)
    await Promise.all(records.map(async (record) => await this.saveRecord(record)))
    return records
  }

  public async saveRecord(record: AiFileChangeRecord, workspaceRootPath?: string): Promise<void> {
    const existing = (await this.store.getRecord({ changeId: record.id })).record
    const next = await this.finalizeRecord(record, existing, workspaceRootPath)
    await this.store.saveRecord(next)
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
    if (
      !response.record ||
      response.record.capability !== 'text_file' ||
      (response.record.operation !== 'created' && response.record.operation !== 'updated')
    ) {
      return response
    }
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

  private async finalizeRecord(
    record: AiFileChangeRecord,
    existing: AiFileChangeRecord | undefined,
    workspaceRootPath?: string
  ): Promise<AiFileChangeRecord> {
    const now = Date.now()
    const next: AiFileChangeRecord = {
      ...record,
      beforePath: record.beforePath || existing?.beforePath,
      afterPath: record.afterPath || existing?.afterPath,
      beforeSnapshotPath: record.beforeSnapshotPath || existing?.beforeSnapshotPath,
      beforeObjectHash: record.beforeObjectHash || existing?.beforeObjectHash,
      beforeChecksum: record.beforeChecksum || existing?.beforeChecksum,
      createdAt: existing?.createdAt || record.createdAt || now,
      updatedAt: now
    }

    const outputPath = next.afterPath || next.path
    if (
      workspaceRootPath &&
      next.operation !== 'deleted' &&
      !next.afterSnapshotPath &&
      (await fileExists(outputPath))
    ) {
      const output = await new WorkspaceObjectStore(workspaceRootPath).putFile(outputPath)
      next.afterSnapshotPath = output.objectPath
      next.afterObjectHash = output.hash
      next.afterChecksum = output.hash
    }

    if (next.status === 'applied' && this.hasNoEffectiveChange(next)) {
      next.status = 'failed'
      next.error = NO_EFFECTIVE_FILE_CHANGE_MESSAGE
    } else if (next.status === 'applied') {
      next.error = undefined
    }
    return next
  }

  private hasNoEffectiveChange(record: AiFileChangeRecord): boolean {
    if (record.source === 'terminal_tool' || record.source === 'workspace_scan') return false
    if (record.operation === 'created') return !record.afterChecksum
    if (record.operation === 'deleted') return !record.beforeChecksum
    if (record.operation === 'renamed') {
      return !record.beforePath || !record.afterPath || record.beforePath === record.afterPath
    }
    return Boolean(
      record.beforeChecksum && record.afterChecksum && record.beforeChecksum === record.afterChecksum
    )
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

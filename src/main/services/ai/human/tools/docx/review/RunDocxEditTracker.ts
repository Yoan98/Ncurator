import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DocxApplyRecord } from '../../../../../../../shared/types'
import type { DocxApplyStore } from '../../../../../storage/domains/DocxApplyStore'
import type { DocxEditSession } from '../types'
import { getDocxWorkerClient } from '../worker/docxWorkerClient'
import { materializeDocxReview } from './reviewSerializer'
import type { RunDocxEditDocument } from './types'
import { calculateFileStats } from './utils'
import { buildDocxApplyArtifactPaths } from './artifactPaths'

type RunState = {
  partnerId: string
  ownerRunId: string
  documentBySourcePath: Map<string, RunDocxEditDocument>
  sourcePathByDocId: Map<string, string>
}
type FirstBaseline = { path: string; created: boolean; checksum: string }

export class RunDocxEditTracker {
  private readonly runEdits = new Map<string, RunState>()
  private readonly firstBaselines = new Map<string, Promise<FirstBaseline>>()
  public constructor(
    private readonly store: DocxApplyStore,
    private readonly removeFileRecord: (id: string) => Promise<void>
  ) {}
  public beginRun(input: { runId: string; ownerRunId?: string; partnerId: string }): void {
    this.runEdits.set(input.runId, {
      partnerId: input.partnerId,
      ownerRunId: input.ownerRunId || input.runId,
      documentBySourcePath: new Map(),
      sourcePathByDocId: new Map()
    })
  }
  public discardRun(runId: string): void {
    this.runEdits.delete(runId)
  }
  public async registerDocxOpen(input: {
    runId: string
    docId: string
    sourcePath: string
    editSession?: DocxEditSession
  }): Promise<void> {
    const state = this.runEdits.get(input.runId)
    if (!state) return
    const sourcePath = path.resolve(input.sourcePath),
      existing = state.documentBySourcePath.get(sourcePath)
    if (existing) {
      existing.latestDocId = input.docId
      existing.editSession = input.editSession || existing.editSession
    } else
      state.documentBySourcePath.set(sourcePath, {
        sourcePath,
        sourceName: path.basename(sourcePath),
        latestDocId: input.docId,
        dirty: false,
        editSession: input.editSession
      })
    state.sourcePathByDocId.set(input.docId, sourcePath)
    if (input.editSession)
      await this.captureFirstBaseline(input.runId, state, sourcePath, input.editSession)
  }

  private captureFirstBaseline(
    runId: string,
    state: RunState,
    sourcePath: string,
    session: DocxEditSession
  ): Promise<FirstBaseline> {
    const key = `${state.ownerRunId}:${sourcePath}`
    const pending = this.firstBaselines.get(key)
    if (pending) return pending
    const promise = (async (): Promise<FirstBaseline> => {
      const paths = buildDocxApplyArtifactPaths({
        partnerId: state.partnerId,
        runId: state.ownerRunId,
        applyId: 'baseline',
        sourceName: path.basename(sourcePath),
        sourcePath
      })
      const metadataPath = `${paths.beforeSnapshotPath}.json`
      let saved: Omit<FirstBaseline, 'path'> | undefined
      try {
        saved = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Omit<FirstBaseline, 'path'>
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (saved) {
        if ((await calculateFileStats(paths.beforeSnapshotPath)).checksum !== saved.checksum)
          throw new Error('docx first baseline checksum mismatch')
        return { ...saved, path: paths.beforeSnapshotPath }
      }
      const source = await getDocxWorkerClient().call({
        runId,
        action: 'materialize_draft',
        payload: { docId: session.sourceDocId, outPath: paths.beforeSnapshotPath }
      })
      if (!source.ok) throw new Error(source.error)
      const baseline = {
        created: session.targetMode === 'create',
        checksum: (await calculateFileStats(paths.beforeSnapshotPath)).checksum
      }
      await fs.writeFile(metadataPath, JSON.stringify(baseline))
      return { ...baseline, path: paths.beforeSnapshotPath }
    })()
    this.firstBaselines.set(key, promise)
    // The first caller owns the source snapshot even if another execution applies first.
    void promise.then(
      () => {
        if (this.firstBaselines.get(key) === promise) this.firstBaselines.delete(key)
      },
      () => {}
    )
    return promise
  }
  public registerDocxChanges(input: {
    runId: string
    previousDocId: string
    nextDocId: string
    editSession?: DocxEditSession
  }): void {
    const state = this.runEdits.get(input.runId),
      sourcePath = state?.sourcePathByDocId.get(input.previousDocId)
    if (!state || !sourcePath) return
    const document = state.documentBySourcePath.get(sourcePath)
    if (!document) return
    state.sourcePathByDocId.set(input.nextDocId, sourcePath)
    document.latestDocId = input.nextDocId
    document.editSession = input.editSession || document.editSession
    document.dirty = true
  }
  public async applyRunEdits(input: {
    retainState?: boolean
    runId: string
    partnerId: string
  }): Promise<DocxApplyRecord[]> {
    const state = this.runEdits.get(input.runId)
    if (!state) return []
    const records: DocxApplyRecord[] = []
    try {
      for (const document of state.documentBySourcePath.values()) {
        if (!document.dirty || !document.editSession) continue
        const existing = (await this.store.listRecords({ partnerId: state.partnerId })).items.find(
          (r) =>
            r.run_id === state.ownerRunId &&
            r.source_path === document.sourcePath &&
            r.status === 'applied'
        )
        const record = await this.applyDocument(input.runId, state, document, existing)
        if (record) {
          await this.store.saveRecord(record)
          records.push(record)
        }
        document.dirty = false
      }
    } finally {
      if (!input.retainState) this.runEdits.delete(input.runId)
    }
    return records
  }
  private async applyDocument(
    runId: string,
    state: RunState,
    document: RunDocxEditDocument,
    existing?: DocxApplyRecord
  ): Promise<DocxApplyRecord | null> {
    const session = document.editSession!
    const id = existing?.id || randomUUID(),
      now = Date.now()
    const paths = buildDocxApplyArtifactPaths({
      partnerId: state.partnerId,
      runId: state.ownerRunId,
      applyId: id,
      sourceName: document.sourceName,
      sourcePath: document.sourcePath
    })
    const baseline = await this.captureFirstBaseline(runId, state, document.sourcePath, session)
    const created = baseline.created,
      baselinePath = baseline.path
    const client = getDocxWorkerClient()
    const response = await client.call({
      runId,
      action: 'materialize_draft',
      payload: { docId: document.latestDocId, outPath: paths.workingArtifactPath }
    })
    if (!response.ok) throw new Error(response.error)
    try {
      const after = await calculateFileStats(document.sourcePath)
      const working = await calculateFileStats(paths.workingArtifactPath)
      if (after.checksum !== working.checksum)
        throw new Error('document changed outside the active docx session before review')
      const net = await materializeDocxReview({
        sourceBuffer: await fs.readFile(baselinePath),
        workingBuffer: await fs.readFile(paths.workingArtifactPath),
        outPath: paths.diffArtifactPath,
        created
      })
      if (!created && net.stats.changeCount === 0) {
        if (existing) {
          await this.store.removeRecord(existing.id)
          await this.removeFileRecord(existing.id)
        }
        await fs.rm(paths.diffArtifactPath, { force: true })
        return null
      }
      const before = created ? undefined : await calculateFileStats(baselinePath)
      const preview = await calculateFileStats(paths.diffArtifactPath)
      return {
        id,
        partner_id: state.partnerId,
        run_id: state.ownerRunId,
        status: 'applied',
        source_path: document.sourcePath,
        source_name: document.sourceName,
        operation: created ? 'created' : 'updated',
        final_revision_ref: session.activeRevisionRef,
        change_count: net.stats.changeCount,
        insert_count: net.stats.insertCount,
        delete_count: net.stats.deleteCount,
        before_exists: !created,
        before_snapshot_path: created ? undefined : baselinePath,
        before_checksum: before?.checksum,
        before_byte_size: before?.byteSize,
        before_modified_at: existing?.before_modified_at || before?.modifiedAt,
        preview_diff_artifact_path: paths.diffArtifactPath,
        preview_diff_checksum: preview.checksum,
        preview_diff_byte_size: preview.byteSize,
        after_checksum: after.checksum,
        after_byte_size: after.byteSize,
        after_modified_at: after.modifiedAt,
        created_at: existing?.created_at || now,
        updated_at: now
      }
    } finally {
      await fs.rm(paths.workingArtifactPath, { force: true })
    }
  }
}

import { getAppRuntime } from '../app/AppRuntime'
import fs from 'fs'
import path from 'path'
import type { EmbeddingService } from '../vector/EmbeddingService'
import { getModelsPath } from '../../utils/paths'
import { defaultModelSource, isModelSource, type ModelSource } from '../../../shared/modelSources'
import type { ModelDownloadProgress } from './ModelService'
import { ModelDownloadError, ModelService } from './ModelService'

const ACTIVE_DOWNLOAD_SNAPSHOT_FILE = '.active-vector-download.json'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export type ActiveVectorDownloadSnapshot = {
  repoId: string
  status: 'downloading'
  progress: number
  currentFile: string
  totalFiles: number
  completedFiles: number
  source: ModelSource
  updatedAt: number
}

type VectorDownloadListener = (payload: ModelDownloadProgress) => void

export class VectorModelDownloadService {
  private static instance: VectorModelDownloadService | null = null

  private activeDownload: {
    repoId: string
    task: Promise<{ success: boolean; error?: string }>
  } | null = null
  private downloadAbortController: AbortController | null = null
  private activeSnapshot: ActiveVectorDownloadSnapshot | null = null
  private readonly listeners = new Set<VectorDownloadListener>()

  private constructor(
    private readonly deps: {
      modelService: ModelService
      embeddingService: EmbeddingService
    }
  ) {}

  public static getInstance(deps?: {
    modelService: ModelService
    embeddingService: EmbeddingService
  }): VectorModelDownloadService {
    if (!VectorModelDownloadService.instance) {
      if (!deps) {
        throw new Error('VectorModelDownloadService requires dependencies on first initialization')
      }
      VectorModelDownloadService.instance = new VectorModelDownloadService(deps)
    }
    return VectorModelDownloadService.instance
  }

  public onProgress(listener: VectorDownloadListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getActiveDownload(): ActiveVectorDownloadSnapshot | null {
    if (!this.activeSnapshot) {
      this.activeSnapshot = this.readSnapshot()
    }
    return this.activeSnapshot ? { ...this.activeSnapshot } : null
  }

  public async initialize(): Promise<void> {
    if (this.activeDownload) {
      return
    }

    const snapshot = this.readSnapshot()
    if (!snapshot) {
      return
    }

    if (this.deps.modelService.isModelDownloaded(snapshot.repoId)) {
      this.clearSnapshot()
      return
    }

    this.activeSnapshot = snapshot
    void this.startDownload(snapshot.repoId)
  }

  public async startDownload(
    repoId: string,
    source?: ModelSource
  ): Promise<{ success: boolean; error?: string; cancelled?: boolean }> {
    const existing = this.activeDownload
    if (existing) {
      if (existing.repoId === repoId) {
        return await existing.task
      }
      return {
        success: false,
        error: 'download already running'
      }
    }

    const resolvedSource =
      source ??
      (this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.source : undefined) ??
      defaultModelSource(getAppRuntime().serviceRoute)

    this.setSnapshot({
      repoId,
      status: 'downloading',
      progress: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.progress : 0,
      currentFile: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.currentFile : '',
      totalFiles: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.totalFiles : 0,
      completedFiles:
        this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.completedFiles : 0,
      source: resolvedSource,
      updatedAt: Date.now()
    })

    this.downloadAbortController?.abort()
    this.downloadAbortController = new AbortController()
    const signal = this.downloadAbortController.signal
    const task = this.runDownload(repoId, resolvedSource, signal)
    this.activeDownload = {
      repoId,
      task
    }

    try {
      const result = await task
      if (!result.success && this.downloadAbortController?.signal.aborted) {
        return { success: true, cancelled: true }
      }
      return result
    } finally {
      if (this.activeDownload?.task === task) {
        this.activeDownload = null
        this.downloadAbortController = null
      }
    }
  }

  public async deleteModel(repoId: string): Promise<{ success: boolean; error?: string }> {
    if (this.activeDownload?.repoId === repoId) {
      this.downloadAbortController?.abort()
      await this.activeDownload.task
    }

    try {
      if (
        !this.deps.embeddingService.isRemote() &&
        repoId === this.deps.embeddingService.getModelName()
      ) {
        await this.deps.embeddingService.reset()
      }
      await this.deps.modelService.deleteModel(repoId)
      if (this.activeSnapshot?.repoId === repoId) {
        this.clearSnapshot()
      }
      return { success: true }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error)
      }
    }
  }

  private async runDownload(
    repoId: string,
    source: ModelSource,
    signal?: AbortSignal
  ): Promise<{ success: boolean; error?: string; failedSource?: ModelSource }> {
    const result = await this.deps.modelService
      .downloadModel(
        repoId,
        (payload) => {
          this.handleProgress(payload)
        },
        signal,
        source
      )
      .catch((error: unknown) => ({
        success: false,
        error: getErrorMessage(error),
        failedSource: error instanceof ModelDownloadError ? error.source : source
      }))

    if (result.success) {
      this.emit({
        repoId,
        status: 'completed',
        progress: 100,
        source
      })
    } else if (this.downloadAbortController?.signal.aborted) {
      this.emit({
        repoId,
        status: 'cancelled',
        progress: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.progress : 0,
        source
      })
    } else {
      const errorMessage = 'error' in result ? result.error : 'download failed'
      this.emit({
        repoId,
        file: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.currentFile : undefined,
        status: 'error',
        progress: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.progress : 0,
        totalFiles: this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.totalFiles : 0,
        completedFiles:
          this.activeSnapshot?.repoId === repoId ? this.activeSnapshot.completedFiles : 0,
        error: errorMessage || 'download failed',
        source,
        failedSource: 'failedSource' in result ? result.failedSource : source
      })
    }

    this.clearSnapshot()
    return result
  }

  private handleProgress(payload: ModelDownloadProgress): void {
    if (payload.status !== 'downloading') {
      return
    }

    this.setSnapshot({
      repoId: payload.repoId,
      status: 'downloading',
      progress: payload.progress,
      currentFile: payload.file || this.activeSnapshot?.currentFile || '',
      totalFiles: payload.totalFiles || this.activeSnapshot?.totalFiles || 0,
      completedFiles: payload.completedFiles || 0,
      source:
        this.activeSnapshot?.repoId === payload.repoId && this.activeSnapshot
          ? this.activeSnapshot.source
          : (payload.source ?? defaultModelSource(getAppRuntime().serviceRoute)),
      updatedAt: Date.now()
    })
    this.emit(payload)
  }

  private emit(payload: ModelDownloadProgress): void {
    for (const listener of this.listeners) {
      listener(payload)
    }
  }

  private resolveSnapshotPath(): string {
    return path.join(getModelsPath(), ACTIVE_DOWNLOAD_SNAPSHOT_FILE)
  }

  private readSnapshot(): ActiveVectorDownloadSnapshot | null {
    try {
      const raw = fs.readFileSync(this.resolveSnapshotPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ActiveVectorDownloadSnapshot>
      const repoId = String(parsed.repoId || '').trim()
      if (!repoId) {
        return null
      }
      return {
        repoId,
        status: 'downloading',
        progress: Math.max(0, Math.min(100, Number(parsed.progress || 0))),
        currentFile: String(parsed.currentFile || ''),
        totalFiles: Math.max(0, Number(parsed.totalFiles || 0)),
        completedFiles: Math.max(0, Number(parsed.completedFiles || 0)),
        source: isModelSource(parsed.source)
          ? parsed.source
          : defaultModelSource(getAppRuntime().serviceRoute),
        updatedAt: Number(parsed.updatedAt || Date.now())
      }
    } catch {
      return null
    }
  }

  private setSnapshot(snapshot: ActiveVectorDownloadSnapshot): void {
    this.activeSnapshot = snapshot
    fs.mkdirSync(getModelsPath(), { recursive: true })
    fs.writeFileSync(this.resolveSnapshotPath(), JSON.stringify(snapshot, null, 2), 'utf8')
  }

  private clearSnapshot(): void {
    this.activeSnapshot = null
    fs.rmSync(this.resolveSnapshotPath(), { force: true })
  }
}

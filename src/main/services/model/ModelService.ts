import fs from 'fs'
import path from 'path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { listModelPathCandidates, MODELS_PATH } from '../../utils/paths'

const HF_ENDPOINT = 'https://hf-mirror.com'
const DOWNLOAD_LOCK_POLL_MS = 1000
const DOWNLOAD_LOCK_STALE_MS = 1000 * 60 * 60
const DOWNLOAD_LOCK_METADATA_FILE = 'owner.json'
const DOWNLOAD_STATE_FILE = '.download-state.json'
const DOWNLOAD_COMPLETE_FILE = '.download-complete.json'
const DOWNLOAD_RETRY_BASE_MS = 2000
const METADATA_FETCH_MAX_ATTEMPTS = 3
const FILE_DOWNLOAD_MAX_ATTEMPTS = 6
const METADATA_FETCH_TIMEOUT_MS = 30_000
const FILE_FETCH_TIMEOUT_MS = 300_000
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type ModelDefinition = {
  id: string
  name: string
  description: string
  tags: string[]
  requiredFiles?: readonly string[]
  downloadFiles?: readonly string[]
}

type ModelDownloadState = {
  repoId: string
  files: string[]
  completedFiles: string[]
  updatedAt: number
}

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: 'jinaai/jina-embeddings-v2-base-zh',
    name: '中文模型 ',
    description: '专为中文语境优化，适合大多数中文知识库场景。',
    tags: ['中文优化', '1.12GB'],
    requiredFiles: [
      '1_Pooling/config.json',
      'config.json',
      'config_sentence_transformers.json',
      'merges.txt',
      'modules.json',
      'onnx/model.onnx',
      'sentence_bert_config.json',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json'
    ],
    downloadFiles: [
      '1_Pooling/config.json',
      'config.json',
      'config_sentence_transformers.json',
      'merges.txt',
      'modules.json',
      'onnx/model.onnx',
      'sentence_bert_config.json',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json'
    ]
  }
]

export type ModelDownloadProgress = {
  repoId: string
  file?: string
  status: 'downloading' | 'completed' | 'error'
  progress: number
  totalFiles?: number
  completedFiles?: number
  error?: string
}

export type ModelDownloadProgressReporter = (event: ModelDownloadProgress) => void

export interface ModelInfo {
  id: string
  name: string
  description: string
  tags: string[]
  isDownloaded: boolean
}

export class ModelService {
  private static instance: ModelService

  private constructor() {}

  public static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService()
    }
    return ModelService.instance
  }

  private getModelDefinition(repoId: string): ModelDefinition | undefined {
    return MODEL_DEFINITIONS.find((model) => model.id === repoId)
  }

  private resolveModelPath(repoId: string): string {
    return path.join(MODELS_PATH, repoId)
  }

  private resolveDownloadLockPath(repoId: string): string {
    return path.join(MODELS_PATH, `${repoId.replaceAll('/', '__')}.download.lock`)
  }

  private resolveDownloadStatePath(repoId: string): string {
    return path.join(this.resolveModelPath(repoId), DOWNLOAD_STATE_FILE)
  }

  private resolveDownloadCompletePath(repoId: string): string {
    return path.join(this.resolveModelPath(repoId), DOWNLOAD_COMPLETE_FILE)
  }

  private isModelDownloadedAtPath(repoId: string, modelPath: string): boolean {
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) {
      return false
    }

    const definition = this.getModelDefinition(repoId)
    const completedState = this.readJsonFileSync<{
      files?: string[]
    }>(path.join(modelPath, DOWNLOAD_COMPLETE_FILE))

    if (Array.isArray(completedState?.files) && completedState.files.length > 0) {
      const completionFilesReady = completedState.files.every((file) =>
        this.hasNonEmptyFile(path.join(modelPath, file))
      )
      if (!completionFilesReady) {
        return false
      }
      if (definition?.requiredFiles && definition.requiredFiles.length > 0) {
        return definition.requiredFiles.every((file) =>
          this.hasNonEmptyFile(path.join(modelPath, file))
        )
      }
      return true
    }

    if (definition?.requiredFiles && definition.requiredFiles.length > 0) {
      return definition.requiredFiles.every((file) =>
        this.hasNonEmptyFile(path.join(modelPath, file))
      )
    }

    return fs.readdirSync(modelPath).length > 0
  }

  private listAlternateDownloadedModelPaths(repoId: string): string[] {
    const currentModelPath = this.resolveModelPath(repoId)
    return listModelPathCandidates()
      .map((modelsPath) => path.join(modelsPath, repoId))
      .filter((candidate) => path.resolve(candidate) !== path.resolve(currentModelPath))
      .filter((candidate) => this.isModelDownloadedAtPath(repoId, candidate))
  }

  private async reuseDownloadedModelFromAlternatePath(repoId: string): Promise<boolean> {
    const alternatePath = this.listAlternateDownloadedModelPaths(repoId)[0]
    if (!alternatePath) {
      return false
    }

    const modelPath = this.resolveModelPath(repoId)
    await fs.promises.mkdir(path.dirname(modelPath), { recursive: true })
    await fs.promises.rm(modelPath, { recursive: true, force: true })
    await fs.promises.symlink(alternatePath, modelPath, 'dir')
    return true
  }

  private hasNonEmptyFile(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath)
      return stats.isFile() && stats.size > 0
    } catch {
      return false
    }
  }

  private readJsonFileSync<TValue>(filePath: string): TValue | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TValue
    } catch {
      return null
    }
  }

  private async readJsonFile<TValue>(filePath: string): Promise<TValue | null> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8')
      return JSON.parse(raw) as TValue
    } catch {
      return null
    }
  }

  private async writeDownloadState(repoId: string, state: ModelDownloadState): Promise<void> {
    await fs.promises.writeFile(
      this.resolveDownloadStatePath(repoId),
      JSON.stringify(state, null, 2),
      'utf8'
    )
  }

  private async markDownloadComplete(repoId: string, files: string[]): Promise<void> {
    await fs.promises.writeFile(
      this.resolveDownloadCompletePath(repoId),
      JSON.stringify(
        {
          repoId,
          files,
          completedAt: Date.now()
        },
        null,
        2
      ),
      'utf8'
    )
    await fs.promises.rm(this.resolveDownloadStatePath(repoId), { force: true })
  }

  private isLargeModelArtifact(filename: string): boolean {
    return (
      filename.endsWith('.safetensors') ||
      filename.endsWith('.bin') ||
      filename.endsWith('.onnx')
    )
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init: RequestInit = {}
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchJsonWithRetry<TValue>(url: string, attempts: number): Promise<TValue> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, METADATA_FETCH_TIMEOUT_MS)
        if (!response.ok) {
          throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`)
        }
        return (await response.json()) as TValue
      } catch (error: unknown) {
        if (attempt === attempts) {
          throw error
        }
        console.warn(
          `[ModelService] Metadata fetch attempt ${String(attempt)} failed for ${url}: ${getErrorMessage(error)}`
        )
        await sleep(DOWNLOAD_RETRY_BASE_MS * attempt)
      }
    }

    throw new Error(`metadata fetch failed for ${url}`)
  }

  private async downloadFileWithRetry(
    url: string,
    destPath: string,
    onProgress: (progress: number) => void
  ): Promise<void> {
    for (let attempt = 1; attempt <= FILE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.downloadFile(url, destPath, onProgress)
        return
      } catch (error: unknown) {
        if (attempt === FILE_DOWNLOAD_MAX_ATTEMPTS) {
          throw error
        }
        console.warn(
          `[ModelService] File download attempt ${String(attempt)} failed for ${url}: ${getErrorMessage(error)}`
        )
        await sleep(DOWNLOAD_RETRY_BASE_MS * attempt)
      }
    }
  }

  private resolveFilesToDownload(repoId: string, siblingNames: Set<string>): string[] {
    const definition = this.getModelDefinition(repoId)
    const requestedFiles = definition?.downloadFiles

    if (!requestedFiles || requestedFiles.length === 0) {
      return Array.from(siblingNames)
    }

    const missingFiles = requestedFiles.filter((filename) => !siblingNames.has(filename))
    if (missingFiles.length > 0) {
      throw new Error(
        `model metadata missing required download files for ${repoId}: ${missingFiles.join(', ')}`
      )
    }

    return [...requestedFiles]
  }

  private async writeLockMetadata(lockPath: string): Promise<void> {
    await fs.promises.writeFile(
      path.join(lockPath, DOWNLOAD_LOCK_METADATA_FILE),
      JSON.stringify({
        pid: process.pid,
        createdAt: Date.now()
      }),
      'utf8'
    )
  }

  private async readLockMetadata(
    lockPath: string
  ): Promise<{
    pid: number
    createdAt: number
  } | null> {
    try {
      const raw = await fs.promises.readFile(path.join(lockPath, DOWNLOAD_LOCK_METADATA_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      const pid = Number(parsed.pid)
      const createdAt = Number(parsed.createdAt)
      if (!Number.isFinite(pid) || !Number.isFinite(createdAt)) {
        return null
      }
      return {
        pid,
        createdAt
      }
    } catch {
      return null
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private emitProgress(
    reporter: ModelDownloadProgressReporter | undefined,
    payload: ModelDownloadProgress
  ): void {
    reporter?.(payload)
  }

  public isModelDownloaded(repoId: string): boolean {
    return this.isModelDownloadedAtPath(repoId, this.resolveModelPath(repoId))
  }

  private async acquireDownloadLock(repoId: string): Promise<() => Promise<void>> {
    const lockPath = this.resolveDownloadLockPath(repoId)
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true })

    while (true) {
      try {
        await fs.promises.mkdir(lockPath)
        await this.writeLockMetadata(lockPath)
        return async () => {
          await fs.promises.rm(lockPath, { recursive: true, force: true })
        }
      } catch (error: unknown) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
        if (code !== 'EEXIST') {
          throw error
        }

        const metadata = await this.readLockMetadata(lockPath)
        if (metadata && !this.isProcessAlive(metadata.pid)) {
          await fs.promises.rm(lockPath, { recursive: true, force: true })
          continue
        }

        if (metadata && Date.now() - metadata.createdAt > DOWNLOAD_LOCK_STALE_MS) {
          await fs.promises.rm(lockPath, { recursive: true, force: true })
          continue
        }

        if (!metadata) {
          const stats = await fs.promises.stat(lockPath).catch(() => null)
          if (!stats || Date.now() - stats.mtimeMs > DOWNLOAD_LOCK_POLL_MS * 5) {
            await fs.promises.rm(lockPath, { recursive: true, force: true })
            continue
          }
        }

        await sleep(DOWNLOAD_LOCK_POLL_MS)
      }
    }
  }

  public getModels(): ModelInfo[] {
    return MODEL_DEFINITIONS.map((m) => {
      const isDownloaded = this.isModelDownloaded(m.id)
      return { ...m, isDownloaded }
    })
  }

  public async deleteModel(repoId: string): Promise<{ success: boolean }> {
    await fs.promises.rm(this.resolveModelPath(repoId), { recursive: true, force: true })
    await fs.promises.rm(this.resolveDownloadLockPath(repoId), { recursive: true, force: true })
    return { success: true }
  }

  private async performDownload(
    repoId: string,
    reporter?: ModelDownloadProgressReporter
  ): Promise<{ success: boolean }> {
    const modelPath = this.resolveModelPath(repoId)

    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(modelPath, { recursive: true })
    }

    try {
      console.log(`[ModelService] Starting download for ${repoId}`)

      const metadataUrl = `${HF_ENDPOINT}/api/models/${repoId}`
      console.log(`[ModelService] Fetching metadata from ${metadataUrl}`)
      const metadata = await this.fetchJsonWithRetry<{
        siblings?: Array<{ rfilename: string }>
      }>(metadataUrl, METADATA_FETCH_MAX_ATTEMPTS)

      const siblings = metadata.siblings || []
      const siblingNames = new Set(siblings.map((file) => String(file.rfilename)))
      const filesToDownload = this.resolveFilesToDownload(repoId, siblingNames)
      const persistedState =
        (await this.readJsonFile<ModelDownloadState>(this.resolveDownloadStatePath(repoId))) || null
      const completedSet = new Set(
        (persistedState?.completedFiles || []).filter((filename) =>
          filesToDownload.includes(filename)
        )
      )

      console.log(`[ModelService] Found ${filesToDownload.length} files to download`)

      let completedFiles = 0
      const totalFiles = filesToDownload.length

      for (const filename of filesToDownload) {
        const fileUrl = `${HF_ENDPOINT}/${repoId}/resolve/main/${filename}`
        const filePath = path.join(modelPath, filename)
        const fileDir = path.dirname(filePath)

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true })
        }

        const reusableExistingFile =
          completedSet.has(filename) ||
          (!this.isLargeModelArtifact(filename) && this.hasNonEmptyFile(filePath))

        if (reusableExistingFile && this.hasNonEmptyFile(filePath)) {
          completedSet.add(filename)
          completedFiles += 1
          continue
        }

        console.log(`[ModelService] Downloading ${filename}...`)

        const baseProgress = Math.round((completedFiles / totalFiles) * 100)
        this.emitProgress(reporter, {
          repoId,
          file: filename,
          status: 'downloading',
          progress: baseProgress,
          totalFiles,
          completedFiles
        })

        let lastProgress = baseProgress
        await this.downloadFileWithRetry(fileUrl, filePath, (fileProgress) => {
          const boundedFileProgress = Math.min(1, Math.max(0, fileProgress))
          const nextProgress = Math.min(
            99,
            Math.max(
              baseProgress,
              Math.round(((completedFiles + boundedFileProgress) / totalFiles) * 100)
            )
          )
          if (nextProgress === lastProgress) {
            return
          }
          lastProgress = nextProgress
          this.emitProgress(reporter, {
            repoId,
            file: filename,
            status: 'downloading',
            progress: nextProgress,
            totalFiles,
            completedFiles
          })
        })

        completedSet.add(filename)
        completedFiles++
        await this.writeDownloadState(repoId, {
          repoId,
          files: filesToDownload,
          completedFiles: [...completedSet],
          updatedAt: Date.now()
        })

        this.emitProgress(reporter, {
          repoId,
          file: filename,
          status: 'downloading',
          progress: Math.round((completedFiles / totalFiles) * 100),
          totalFiles,
          completedFiles
        })
      }

      await this.markDownloadComplete(repoId, filesToDownload)

      console.log(`[ModelService] Download complete for ${repoId}`)
      this.emitProgress(reporter, {
        repoId,
        status: 'completed',
        progress: 100
      })

      return { success: true }
    } catch (error: unknown) {
      console.error('[ModelService] Download error:', error)
      this.emitProgress(reporter, {
        repoId,
        status: 'error',
        progress: 0,
        error: getErrorMessage(error)
      })
      throw error
    }
  }

  public async downloadModel(
    repoId: string,
    reporter?: ModelDownloadProgressReporter
  ): Promise<{ success: boolean }> {
    const releaseLock = await this.acquireDownloadLock(repoId)
    try {
      if (this.isModelDownloaded(repoId)) {
        this.emitProgress(reporter, {
          repoId,
          status: 'completed',
          progress: 100
        })
        return { success: true }
      }

      if (await this.reuseDownloadedModelFromAlternatePath(repoId)) {
        this.emitProgress(reporter, {
          repoId,
          status: 'completed',
          progress: 100
        })
        return { success: true }
      }

      return await this.performDownload(repoId, reporter)
    } finally {
      await releaseLock()
    }
  }

  private async downloadFile(
    url: string,
    destPath: string,
    onProgress: (progress: number) => void
  ) {
    const tempPath = `${destPath}.part`
    const existingPartialBytes = this.hasNonEmptyFile(tempPath) ? fs.statSync(tempPath).size : 0
    const response = await this.fetchWithTimeout(url, FILE_FETCH_TIMEOUT_MS, {
      headers:
        existingPartialBytes > 0
          ? {
              Range: `bytes=${String(existingPartialBytes)}-`
            }
          : undefined
    })

    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
    }
    if (!response.body) throw new Error(`No body in response for ${url}`)

    let fileStartBytes = 0
    let fileFlags: 'w' | 'a' = 'w'
    if (existingPartialBytes > 0 && response.status === 206) {
      fileStartBytes = existingPartialBytes
      fileFlags = 'a'
    } else if (existingPartialBytes > 0) {
      await fs.promises.rm(tempPath, { force: true })
    }

    const fileStream = fs.createWriteStream(tempPath, { flags: fileFlags })
    const chunkLength = +(response.headers.get('Content-Length') || 0)
    const totalLength = chunkLength > 0 ? fileStartBytes + chunkLength : 0
    let receivedLength = fileStartBytes

    try {
      const source = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>)
      const progressStream = new Transform({
        transform(chunk, _encoding, callback) {
          receivedLength += Buffer.byteLength(chunk)
          if (totalLength > 0) {
            onProgress(receivedLength / totalLength)
          }
          callback(null, chunk)
        }
      })
      await pipeline(source, progressStream, fileStream)
      await fs.promises.rename(tempPath, destPath)
    } catch (error: unknown) {
      fileStream.destroy()
      throw error
    }
  }
}

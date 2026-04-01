import fs from 'fs'
import path from 'path'
import { MODELS_PATH } from '../../utils/paths'

const HF_ENDPOINT = 'https://hf-mirror.com'
const DOWNLOAD_LOCK_POLL_MS = 1000
const DOWNLOAD_LOCK_STALE_MS = 1000 * 60 * 60
const DOWNLOAD_LOCK_METADATA_FILE = 'owner.json'
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
}

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: 'jinaai/jina-embeddings-v2-base-zh',
    name: '中文模型 ',
    description: '专为中文语境优化，适合大多数中文知识库场景。',
    tags: ['中文优化', '1.12GB'],
    requiredFiles: ['config.json', 'tokenizer.json']
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
  private static activeDownloads = new Map<string, Promise<{ success: boolean }>>()

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
    const modelPath = this.resolveModelPath(repoId)
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) {
      return false
    }

    const definition = this.getModelDefinition(repoId)
    if (definition?.requiredFiles && definition.requiredFiles.length > 0) {
      return definition.requiredFiles.every((file) => fs.existsSync(path.join(modelPath, file)))
    }

    return fs.readdirSync(modelPath).length > 0
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
      const response = await fetch(metadataUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.statusText}`)
      }
      const metadata = await response.json()

      const siblings = metadata.siblings || []
      const filesToDownload = siblings.filter(() => true)

      console.log(`[ModelService] Found ${filesToDownload.length} files to download`)

      let completedFiles = 0
      const totalFiles = filesToDownload.length

      for (const file of filesToDownload) {
        const filename = file.rfilename
        const fileUrl = `${HF_ENDPOINT}/${repoId}/resolve/main/${filename}`
        const filePath = path.join(modelPath, filename)
        const fileDir = path.dirname(filePath)

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true })
        }

        console.log(`[ModelService] Downloading ${filename}...`)

        this.emitProgress(reporter, {
          repoId,
          file: filename,
          status: 'downloading',
          progress: 0,
          totalFiles,
          completedFiles
        })

        await this.downloadFile(fileUrl, filePath, () => {
        })

        completedFiles++

        this.emitProgress(reporter, {
          repoId,
          file: filename,
          status: 'downloading',
          progress: Math.round((completedFiles / totalFiles) * 100),
          totalFiles,
          completedFiles
        })
      }

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
    const existing = ModelService.activeDownloads.get(repoId)
    if (existing) {
      return existing
    }

    const task = (async () => {
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

        return await this.performDownload(repoId, reporter)
      } finally {
        await releaseLock()
      }
    })()

    ModelService.activeDownloads.set(repoId, task)
    try {
      return await task
    } finally {
      ModelService.activeDownloads.delete(repoId)
    }
  }

  private async downloadFile(
    url: string,
    destPath: string,
    onProgress: (progress: number) => void
  ) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.statusText}`)
    if (!response.body) throw new Error(`No body in response for ${url}`)

    const fileStream = fs.createWriteStream(destPath)
    const reader = response.body.getReader()
    const contentLength = +(response.headers.get('Content-Length') || 0)
    let receivedLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      fileStream.write(Buffer.from(value))
      receivedLength += value.length
      if (contentLength > 0) {
        onProgress(receivedLength / contentLength)
      }
    }

    fileStream.end()
  }
}

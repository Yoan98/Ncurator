import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import type {
  EmbeddingExecutor,
  EmbeddingResult,
  EmbeddingRuntimePendingRequest,
  EmbeddingRuntimeRequest,
  EmbeddingRuntimeResponse,
  EmbeddingThreadBudget
} from './types'
import { resolveOrtThreadBudget, toEmbeddingRuntimeEnv } from '../indexSpeed'
import type { AppErrorLogService } from '../../logging/AppErrorLogService'

const DEFAULT_RUNTIME_TIMEOUT_MS = 180_000

export class EmbeddingRuntimeClient implements EmbeddingExecutor {
  private readonly entryPath: string
  private readonly modelsPath: string
  private readonly modelName: string
  private readonly timeoutMs: number
  private readonly errorLogService?: AppErrorLogService
  private threadBudget: EmbeddingThreadBudget
  private process: UtilityProcess | null = null
  private processReady: Promise<UtilityProcess> | null = null
  private initializedProcess: UtilityProcess | null = null
  private initializationPromise: Promise<void> | null = null
  private readonly pending = new Map<string, EmbeddingRuntimePendingRequest>()
  private closing = false

  public constructor(input: {
    entryPath: string
    modelsPath: string
    modelName: string
    timeoutMs?: number
    threadBudget?: EmbeddingThreadBudget
    errorLogService?: AppErrorLogService
  }) {
    this.entryPath = String(input.entryPath || '').trim()
    this.modelsPath = String(input.modelsPath || '').trim()
    this.modelName = String(input.modelName || '').trim()
    this.timeoutMs = Math.max(1_000, input.timeoutMs || DEFAULT_RUNTIME_TIMEOUT_MS)
    this.threadBudget = input.threadBudget || resolveOrtThreadBudget('slow')
    this.errorLogService = input.errorLogService
    if (!this.entryPath) throw new Error('embedding runtime entryPath is required')
    if (!this.modelsPath) throw new Error('embedding runtime modelsPath is required')
    if (!this.modelName) throw new Error('embedding runtime modelName is required')
  }

  public setThreadBudget(budget: EmbeddingThreadBudget): void {
    this.threadBudget = budget
  }

  private async ensureProcess(): Promise<UtilityProcess> {
    if (this.closing) throw new Error('embedding runtime client is closed')
    if (this.process && this.processReady) return await this.processReady
    if (!fs.existsSync(this.entryPath)) {
      const error = new Error(`embedding runtime entry not found: ${this.entryPath}`)
      this.logError(error, 'entry-missing')
      throw error
    }

    const child = utilityProcess.fork(this.entryPath, [], {
      serviceName: 'Ncurator Embedding Runtime',
      stdio: 'pipe',
      env: {
        ...process.env,
        NCURATOR_EMBEDDING_MODELS_PATH: this.modelsPath,
        NCURATOR_EMBEDDING_MODEL_NAME: this.modelName,
        ...toEmbeddingRuntimeEnv(this.threadBudget)
      }
    })
    this.process = child
    this.initializedProcess = null

    child.on('message', (message: unknown) => {
      const response = message as EmbeddingRuntimeResponse
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })
    child.on('error', (_type, location, report) => {
      console.error(`[EMBEDDING-RUNTIME] fatal error at ${location}: ${report}`)
      this.logError(new Error(`fatal error at ${location}: ${report}`), 'fatal-error')
    })
    child.on('exit', (code) => {
      this.handleProcessExit(child, code)
    })
    child.stdout?.on('data', (chunk) => {
      console.log(`[EMBEDDING-RUNTIME] ${String(chunk).trimEnd()}`)
    })
    child.stderr?.on('data', (chunk) => {
      console.error(`[EMBEDDING-RUNTIME] ${String(chunk).trimEnd()}`)
      this.logError(new Error(String(chunk).trim()), 'stderr')
    })

    this.processReady = new Promise<UtilityProcess>((resolve, reject) => {
      const onSpawn = (): void => {
        child.removeListener('exit', onEarlyExit)
        resolve(child)
      }
      const onEarlyExit = (code: number): void => {
        child.removeListener('spawn', onSpawn)
        reject(new Error(`embedding runtime exited before spawn completed with code ${code}`))
      }
      child.once('spawn', onSpawn)
      child.once('exit', onEarlyExit)
    })
    return await this.processReady
  }

  private handleProcessExit(child: UtilityProcess, code: number): void {
    if (this.process !== child) return
    const error = new Error(`embedding runtime exited with code ${code}`)
    if (!this.closing) this.logError(error, 'exit', code)
    this.process = null
    this.processReady = null
    this.initializedProcess = null
    this.initializationPromise = null
    this.failAllPending(error)
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private async call(request: EmbeddingRuntimeRequest): Promise<EmbeddingRuntimeResponse> {
    const child = await this.ensureProcess()
    return await new Promise<EmbeddingRuntimeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        if (this.process === child) child.kill()
        const error = new Error(`embedding runtime request timed out: ${request.action}`)
        this.logError(error, 'timeout')
        reject(error)
      }, this.timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      child.postMessage(request)
    })
  }

  public async initialize(): Promise<void> {
    const child = await this.ensureProcess()
    if (this.initializedProcess === child) return
    if (this.initializationPromise) {
      await this.initializationPromise
      return
    }

    this.initializationPromise = (async () => {
      const response = await this.call({
        requestId: randomUUID(),
        action: 'initialize',
        payload: this.threadBudget
      })
      if (response.action !== 'initialize' || !response.ok) {
        const error = new Error(response.error || 'embedding runtime initialization failed')
        this.logError(error, 'initialize')
        throw error
      }
      this.initializedProcess = child
    })().finally(() => {
      this.initializationPromise = null
    })
    await this.initializationPromise
  }

  public async embed(texts: string[]): Promise<EmbeddingResult> {
    await this.initialize()
    const response = await this.call({
      requestId: randomUUID(),
      action: 'embed',
      payload: { texts }
    })
    if (response.action !== 'embed' || !response.ok || !response.payload) {
      const error = new Error(response.error || 'embedding runtime inference failed')
      this.logError(error, 'embed')
      throw error
    }
    return response.payload
  }

  public async restart(): Promise<void> {
    await this.close()
    this.closing = false
  }

  public async close(): Promise<void> {
    this.closing = true
    const child = this.process
    this.process = null
    this.processReady = null
    this.initializedProcess = null
    this.initializationPromise = null
    this.failAllPending(new Error('embedding runtime client closed'))
    child?.kill()
  }

  private logError(error: Error, event: string, exitCode?: number): void {
    this.errorLogService?.write({
      module: 'embedding-runtime',
      error,
      context: { event, model: this.modelName, exitCode }
    })
  }
}

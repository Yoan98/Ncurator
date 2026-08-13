import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_PREPARE_WORKER_TIMEOUT_MS } from '../constants'
import type {
  WorkspacePreparedSource,
  WorkspacePrepareWorkerClientOptions,
  WorkspacePrepareWorkerInput,
  WorkspacePrepareWorkerPendingRequest,
  WorkspacePrepareWorkerRequest,
  WorkspacePrepareWorkerResponse
} from '../types'

export class WorkspacePrepareWorkerClient {
  private worker: Worker | null = null
  private readonly workerUrl: URL
  private readonly errorLogService?: WorkspacePrepareWorkerClientOptions['errorLogService']
  private readonly pending = new Map<string, WorkspacePrepareWorkerPendingRequest>()

  public constructor(options: WorkspacePrepareWorkerClientOptions = {}) {
    this.workerUrl = options.workerUrl || new URL('./workspacePrepareWorker.js', import.meta.url)
    this.errorLogService = options.errorLogService
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const workerPath = fileURLToPath(this.workerUrl)
    if (!fs.existsSync(workerPath)) {
      throw new Error(`workspace prepare worker entry not found: ${workerPath}`)
    }
    const worker = new Worker(this.workerUrl, { name: 'workspace-prepare-worker' })
    worker.on('message', (response: WorkspacePrepareWorkerResponse) => {
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })
    worker.on('error', (error) => {
      this.logError(error, 'error')
      this.failAllPending(new Error(`workspace prepare worker error: ${error.message}`))
      this.worker = null
    })
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logError(new Error(`workspace prepare worker exited with code ${code}`), 'exit', code)
        this.failAllPending(new Error(`workspace prepare worker exited with code ${code}`))
      }
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private failAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  public async prepareSource(input: WorkspacePrepareWorkerInput): Promise<WorkspacePreparedSource> {
    const request: WorkspacePrepareWorkerRequest = {
      requestId: randomUUID(),
      action: 'prepare_source',
      payload: input
    }
    const worker = this.ensureWorker()
    const response = await new Promise<WorkspacePrepareWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        if (this.worker === worker) this.worker = null
        void worker.terminate().catch(() => {})
        const error = new Error('workspace prepare worker timeout')
        this.logError(error, 'timeout')
        reject(error)
      }, WORKSPACE_PREPARE_WORKER_TIMEOUT_MS)
      this.pending.set(request.requestId, { resolve, reject, timeout })
      worker.postMessage(request)
    })
    if (!response.ok || !response.payload) {
      const error = new Error(response.error || 'workspace prepare worker failed')
      this.logError(error, 'response')
      throw error
    }
    return response.payload
  }

  public async close(): Promise<void> {
    const worker = this.worker
    this.worker = null
    this.failAllPending(new Error('workspace prepare worker client closed'))
    await worker?.terminate()
  }

  private logError(error: Error, event: string, exitCode?: number): void {
    this.errorLogService?.write({
      module: 'workspace-prepare-worker',
      error,
      context: { event, exitCode }
    })
  }
}

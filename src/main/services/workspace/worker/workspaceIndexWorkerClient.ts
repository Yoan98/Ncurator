import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { MODELS_PATH } from '../../../utils/paths'
import { WORKSPACE_INDEX_WORKER_TIMEOUT_MS } from '../constants'
import type {
  WorkspaceIndexWorkerClientOptions,
  WorkspaceIndexWorkerPendingRequest,
  WorkspaceIndexWorkerRequest,
  WorkspaceIndexWorkerResponse,
  WorkspaceIndexWorkerRequestHandler,
  WorkspaceKnowledgePrepareWorkerInput,
  WorkspaceKnowledgePrepareWorkerResult
} from '../types'
import { handleWorkspaceIndexWorkerRequest } from './workspaceIndexWorker'

export class WorkspaceIndexWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<string, WorkspaceIndexWorkerPendingRequest>()
  private inProcessMode = false
  private readonly workerUrl: URL
  private readonly fallbackHandler: WorkspaceIndexWorkerRequestHandler

  public constructor(options: WorkspaceIndexWorkerClientOptions = {}) {
    this.workerUrl = options.workerUrl || new URL('./workspaceIndexWorker.js', import.meta.url)
    this.fallbackHandler = options.fallbackHandler || handleWorkspaceIndexWorkerRequest
  }

  private ensureWorker(): Worker {
    if (this.inProcessMode) {
      throw new Error('workspace index worker is running in in-process mode')
    }
    if (this.worker) return this.worker
    const workerPath = fileURLToPath(this.workerUrl)
    if (!fs.existsSync(workerPath)) {
      this.inProcessMode = true
      throw new Error(`workspace index worker entry not found: ${workerPath}`)
    }
    const worker = new Worker(this.workerUrl, {
      name: 'workspace-index-worker',
      workerData: { modelsPath: MODELS_PATH }
    })
    worker.on('message', (response: WorkspaceIndexWorkerResponse) => {
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })
    worker.on('error', (error) => {
      this.failAllPending(new Error(`workspace index worker error: ${error.message}`))
      this.worker = null
    })
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.failAllPending(new Error(`workspace index worker exited with code ${code}`))
      }
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private failAllPending(error: Error): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout)
      item.reject(error)
    }
    this.pending.clear()
  }

  private async call(
    payload: WorkspaceKnowledgePrepareWorkerInput,
    timeoutMs = WORKSPACE_INDEX_WORKER_TIMEOUT_MS
  ): Promise<WorkspaceIndexWorkerResponse> {
    const request: WorkspaceIndexWorkerRequest = {
      requestId: randomUUID(),
      action: 'prepare_file',
      payload
    }

    if (this.inProcessMode) {
      return await this.fallbackHandler(request)
    }

    let worker: Worker
    try {
      worker = this.ensureWorker()
    } catch {
      this.inProcessMode = true
      return await this.fallbackHandler(request)
    }

    return await new Promise<WorkspaceIndexWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.requestId)
        if (this.worker === worker) {
          this.worker = null
        }
        void worker.terminate().catch(() => {})
        reject(new Error('workspace index worker timeout'))
      }, Math.max(1_000, timeoutMs))
      this.pending.set(request.requestId, {
        resolve,
        reject,
        timeout
      })
      worker.postMessage(request)
    })
  }

  public async prepareSource(
    input: WorkspaceKnowledgePrepareWorkerInput
  ): Promise<WorkspaceKnowledgePrepareWorkerResult> {
    const response = await this.call(input)
    if (!response.ok || !response.payload) {
      throw new Error(response.error || 'workspace index worker failed')
    }
    return response.payload
  }
}

let singleton: WorkspaceIndexWorkerClient | null = null

export const getWorkspaceIndexWorkerClient = (): WorkspaceIndexWorkerClient => {
  if (!singleton) singleton = new WorkspaceIndexWorkerClient()
  return singleton
}

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type {
  DocxWorkerAction,
  DocxWorkerRequest,
  DocxWorkerResponse,
  PendingRequest
} from './types'
import { handleDocxWorkerRequest } from './docxWorker'

const DEFAULT_TIMEOUT_MS = 20_000

class DocxWorkerClient {
  private worker: Worker | null = null
  private pending: Map<string, PendingRequest> = new Map()
  private inProcessMode = false
  private readonly workerUrl = new URL('./docxWorker.js', import.meta.url)

  private ensureWorker(): Worker {
    if (this.inProcessMode) {
      throw new Error('docx worker is running in in-process mode')
    }
    if (this.worker) return this.worker
    const workerPath = fileURLToPath(this.workerUrl)
    if (!fs.existsSync(workerPath)) {
      this.inProcessMode = true
      throw new Error(`docx worker entry not found: ${workerPath}`)
    }
    const worker = new Worker(this.workerUrl, {
      name: 'docx-worker'
    })
    worker.on('message', (response: DocxWorkerResponse) => {
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })
    worker.on('error', (error) => {
      this.failAllPending(new Error(`docx worker error: ${error.message}`))
      this.worker = null
    })
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.failAllPending(new Error(`docx worker exited with code ${code}`))
      }
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private failAllPending(error: Error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout)
      item.reject(error)
    }
    this.pending.clear()
  }

  public async call<TAction extends DocxWorkerAction>(
    input: Omit<Extract<DocxWorkerRequest, { action: TAction }>, 'requestId'>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<DocxWorkerResponse> {
    const requestId = randomUUID()
    const request = {
      ...input,
      requestId
    } as Extract<DocxWorkerRequest, { action: TAction }>

    if (this.inProcessMode) {
      return await handleDocxWorkerRequest(request)
    }

    let worker: Worker
    try {
      worker = this.ensureWorker()
    } catch {
      this.inProcessMode = true
      return await handleDocxWorkerRequest(request)
    }

    return await new Promise<DocxWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(requestId)
          reject(new Error(`docx worker timeout (${input.action})`))
        },
        Math.max(1_000, timeoutMs)
      )

      this.pending.set(requestId, {
        resolve,
        reject,
        timeout
      })

      worker.postMessage(request)
    })
  }
}

let singleton: DocxWorkerClient | null = null

export const getDocxWorkerClient = (): DocxWorkerClient => {
  if (!singleton) singleton = new DocxWorkerClient()
  return singleton
}

export const releaseDocxRunSession = async (runId: string): Promise<void> => {
  if (!singleton) return
  try {
    await singleton.call({
      runId,
      action: 'release_run',
      payload: {}
    })
  } catch {
    // ignore release failures
  }
}

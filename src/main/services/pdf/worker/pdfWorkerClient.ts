import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { getUserDataPath } from '../../../utils/userDataPath'
import { handlePdfWorkerRequest } from './pdfWorker'
import type {
  PdfWorkerAction,
  PdfWorkerRequest,
  PdfWorkerResponse,
  PendingPdfWorkerRequest
} from './types'

const DEFAULT_TIMEOUT_MS = 45_000

class PdfWorkerClient {
  private worker: Worker | null = null
  private readonly pending = new Map<string, PendingPdfWorkerRequest>()
  private inProcessMode = false
  private readonly workerUrl = new URL('./pdfWorker.js', import.meta.url)

  private ensureWorker(): Worker {
    if (this.inProcessMode) throw new Error('pdf worker is running in-process')
    if (this.worker) return this.worker
    const workerPath = fileURLToPath(this.workerUrl)
    if (!fs.existsSync(workerPath)) {
      this.inProcessMode = true
      throw new Error(`pdf worker entry not found: ${workerPath}`)
    }
    const worker = new Worker(this.workerUrl, {
      name: 'pdf-worker',
      env: {
        ...process.env,
        NCURATOR_USER_DATA_PATH: getUserDataPath()
      }
    })
    worker.on('message', (response: PdfWorkerResponse) => {
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.requestId)
      pending.resolve(response)
    })
    worker.on('error', (error) => {
      this.failPending(new Error(`pdf worker error: ${error.message}`))
      this.worker = null
    })
    worker.on('exit', (code) => {
      if (code !== 0) this.failPending(new Error(`pdf worker exited with code ${String(code)}`))
      this.worker = null
    })
    this.worker = worker
    return worker
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  public async call<TAction extends PdfWorkerAction>(
    input: Omit<Extract<PdfWorkerRequest, { action: TAction }>, 'requestId'>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<PdfWorkerResponse> {
    const request = { ...input, requestId: randomUUID() } as Extract<
      PdfWorkerRequest,
      { action: TAction }
    >
    if (this.inProcessMode) return await handlePdfWorkerRequest(request)

    let worker: Worker
    try {
      worker = this.ensureWorker()
    } catch {
      this.inProcessMode = true
      return await handlePdfWorkerRequest(request)
    }

    return await new Promise<PdfWorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(request.requestId)
          reject(new Error(`pdf worker timeout (${input.action})`))
        },
        Math.max(1000, timeoutMs)
      )
      this.pending.set(request.requestId, { resolve, reject, timeout })
      worker.postMessage(request)
    })
  }
}

let singleton: PdfWorkerClient | null = null

export const getPdfWorkerClient = (): PdfWorkerClient => {
  if (!singleton) singleton = new PdfWorkerClient()
  return singleton
}

export const releasePdfRunSession = async (runId: string): Promise<void> => {
  if (!singleton) return
  try {
    await singleton.call({ runId, action: 'release_run', payload: {} })
  } catch {
    // ignore release failures
  }
}

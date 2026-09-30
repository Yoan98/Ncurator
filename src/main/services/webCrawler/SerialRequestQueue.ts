type QueueEntry = { start: () => Promise<void>; reject: (error: Error) => void; cancelled: boolean }
const cancelledError = (): Error & { code: 'CANCELLED' } =>
  Object.assign(new Error('已取消'), { code: 'CANCELLED' as const })

/** Cancellation settles the caller immediately; an already submitted request keeps its FIFO slot. */
export class SerialRequestQueue {
  private readonly pending: QueueEntry[] = []
  private active = false
  private closed = false

  public enqueue<T>(execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error('web crawler sidecar closed'))
    if (signal?.aborted) return Promise.reject(cancelledError())
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        entry.cancelled = true
        const pendingIndex = this.pending.indexOf(entry)
        if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1)
        signal?.removeEventListener('abort', abort)
        reject(cancelledError())
      }
      const entry: QueueEntry = {
        cancelled: false,
        reject,
        start: async () => {
          try {
            if (!entry.cancelled) {
              const result = await execute()
              if (!entry.cancelled) resolve(result)
            }
          } catch (error) {
            if (!entry.cancelled) reject(error)
          } finally {
            signal?.removeEventListener('abort', abort)
          }
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.push(entry)
      this.advance()
    })
  }

  public close(): void {
    this.closed = true
    for (const entry of this.pending.splice(0)) {
      entry.reject(new Error('web crawler sidecar closed'))
      entry.cancelled = true
      // run the skipped entry to release its signal listener
      void entry.start()
    }
  }

  private advance(): void {
    if (this.active || this.closed) return
    const entry = this.pending.shift()
    if (!entry) return
    this.active = true
    void entry.start().finally(() => {
      this.active = false
      this.advance()
    })
  }
}

type Waiting = { start: () => void; cancel: () => void }
let active = false
const waiting: Waiting[] = []

/** One rendering target at a time, including AI-authored drawing tasks. */
export const acquireMediaRender = (signal?: AbortSignal): Promise<() => void> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const entry: Waiting = {
      start: () => {
        signal?.removeEventListener('abort', entry.cancel)
        active = true
        let released = false
        resolve(() => {
          if (released) return
          released = true
          const next = waiting.shift()
          if (next) next.start()
          else active = false
        })
      },
      cancel: () => {
        const index = waiting.indexOf(entry)
        if (index >= 0) waiting.splice(index, 1)
        signal?.removeEventListener('abort', entry.cancel)
        reject(new Error('Media operation cancelled'))
      }
    }
    if (active) {
      waiting.push(entry)
      signal?.addEventListener('abort', entry.cancel, { once: true })
    } else entry.start()
  })

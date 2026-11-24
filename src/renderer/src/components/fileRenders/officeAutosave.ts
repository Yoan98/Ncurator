import type { WriteTextFileResponse } from '../../../../shared/types'
import { sha256Hex } from '../../utils/fileHash'
import { registerTextSave } from './pendingTextSaves'
import { t } from '../../i18n'

export type DocumentSaveStatus = 'idle' | 'saving' | 'error' | 'conflict'
export async function createOfficeAutosave(
  filePath: string,
  initial: Uint8Array,
  save: (expectedHash: string) => Promise<WriteTextFileResponse>,
  events: {
    status: (value: DocumentSaveStatus, message?: string) => void
    reload: (external?: boolean) => void
    editable: (value: boolean) => void
    readOnly?: boolean
  }
) {
  let hash = await sha256Hex(initial)
  let revision = 0,
    saved = 0,
    paused = false,
    disposed = false,
    reloading = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    if (pending) return pending
    if (revision === saved) return Promise.resolve()
    pending = (async () => {
      events.status('saving')
      while (saved < revision) {
        const version = revision
        const response = await save(hash)
        if (!response.success || !response.hash) {
          const error = new Error(response.error || t(($) => $.editors.wordSaveFailed))
          if (response.conflict) error.name = 'OfficeConflict'
          throw error
        }
        hash = response.hash
        saved = version
      }
      events.status('idle')
    })()
      .catch((error: Error) => {
        events.status(error.name === 'OfficeConflict' ? 'conflict' : 'error', error.message)
        throw error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const unregister = events.readOnly
    ? undefined
    : registerTextSave(filePath, {
        save: flush,
        pause() {
          paused = true
          events.editable(false)
        },
        resume() {
          paused = false
          events.editable(true)
        },
        discard() {
          saved = revision
          paused = true
        }
      })
  let watchId: string | undefined
  const check = async () => {
    if (disposed || reloading) return
    await pending?.catch(() => undefined)
    const previous = hash
    const current = await sha256Hex(await window.api.readFile(filePath))
    if (disposed || reloading || previous !== hash || current === hash) return
    if (saved !== revision)
      events.status(
        'conflict',
        t(($) => $.editors.wordConflict)
      )
    else {
      reloading = true
      events.reload(true)
    }
  }
  const recheck = () =>
    void check().catch((error: Error) => {
      if (!disposed) events.status('error', error.message)
    })
  const unsubscribe = window.api.onFileWatchChange((event) => {
    if (event.watchId === watchId) recheck()
  })
  window.addEventListener('focus', recheck)
  void window.api
    .fileWatchStart({ filePath })
    .then((result) => {
      if (!result.watchId) return
      if (disposed) void window.api.fileWatchStop({ watchId: result.watchId })
      else {
        watchId = result.watchId
        recheck()
      }
    })
    .catch((error: Error) => events.status('error', error.message))
  return {
    flush,
    changed() {
      if (disposed || events.readOnly) return
      revision++
      clearTimeout(timer)
      if (!paused) timer = setTimeout(() => void flush().catch(() => undefined), 400)
    },
    discard() {
      saved = revision
      events.reload()
    },
    async close() {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('focus', recheck)
      if (watchId) void window.api.fileWatchStop({ watchId })
      unregister?.()
      await flush()
    }
  }
}

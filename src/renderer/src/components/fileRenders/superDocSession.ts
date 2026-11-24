import 'superdoc/style.css'
import { prepareSuperDocReview } from './superDocReview'
import { t } from '../../i18n'
import { sha256Hex } from '../../utils/fileHash'
import { registerTextSave } from './pendingTextSaves'

export type DocumentSaveStatus = 'idle' | 'saving' | 'error' | 'conflict'
export async function openSuperDoc(
  host: HTMLElement,
  source: Blob,
  filePath: string | undefined,
  events: {
    toolbar: HTMLElement
    review: boolean
    ready: () => void
    layout: () => void
    status: (value: DocumentSaveStatus, message?: string) => void
    reload: (external?: boolean) => void
  }
) {
  const writable = filePath && (await window.api.canWriteDocx(filePath))
  let hash = filePath ? await sha256Hex(new Uint8Array(await source.arrayBuffer())) : ''
  let revision = 0,
    saved = 0
  let ready = false,
    paused = false,
    disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined
  const review = events.review ? await prepareSuperDocReview(source) : undefined
  let frame = 0
  const layout = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!disposed) {
        review?.decorate(host)
        events.layout()
      }
    })
  }
  const observer = review ? new MutationObserver(() => review.decorate(host)) : undefined
  observer?.observe(host, { subtree: true, childList: true })
  const moduleUrl = 'ncurator-editor://superdoc/editor.js'
  const { SuperDoc }: typeof import('superdoc') = await import(/* @vite-ignore */ moduleUrl)
  const editor = new SuperDoc({
    selector: host,
    document: new File([review?.document ?? source], 'document.docx'),
    documentMode: writable ? 'editing' : 'viewing',
    ui: {
      toolbar: {
        container: events.toolbar,
        ...(writable
          ? {
              excludeItems: [
                'ai',
                'document-mode',
                'comments-layout',
                'track-changes-accept-selection',
                'track-changes-reject-selection'
              ] as const
            }
          : { items: { left: ['search'], right: ['zoom'] } as const }),
        responsiveTo: 'container',
        overflow: 'menu',
        strings: t(($) => $.editors.wordToolbar, { returnObjects: true })
      },
      comments: { panel: false, highlights: false },
      loading: false,
      search: {
        replaceControls: Boolean(writable),
        strings: t(($) => $.editors.wordSearch, { returnObjects: true })
      }
    },
    interaction: {
      comments: { level: 'read' },
      trackedChanges: { allowDecisions: false }
    },
    handleImageUpload: (file) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () =>
          reject(reader.error ?? new Error(t(($) => $.editors.wordImageLoadFailed)))
        reader.readAsDataURL(file)
      }),
    // References and immutable review marks use browser Range geometry across pages.
    layoutEngineOptions: { virtualization: { enabled: false } },
    zoom: { mode: 'fit-width', fitWidth: { max: 100 } },
    onZoomChange: layout,
    allowSelectionInViewMode: true,
    telemetry: { enabled: false },
    onReady() {
      ready = true
      events.ready()
      layout()
    },
    onContentError: ({ error }) => events.status('error', String(error)),
    onException(payload) {
      if (
        !ready &&
        'error' in payload &&
        !('itemName' in payload) &&
        !('source' in payload) &&
        !('diagnosticCode' in payload)
      )
        events.status('error', String(payload.error))
    },
    onPaginationUpdate: layout,
    onEditorUpdate() {
      if (!ready || !writable || disposed) return
      revision++
      clearTimeout(timer)
      if (!paused) timer = setTimeout(() => void flush().catch(() => undefined), 400)
    }
  })
  async function flush() {
    clearTimeout(timer)
    if (pending) return pending
    if (!writable || !filePath || saved === revision) return
    const path = filePath
    pending = (async () => {
      events.status('saving')
      while (saved < revision) {
        const version = revision
        const blob = await editor.export({ triggerDownload: false })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const response = await window.api.writeDocxFile({
          filePath: path,
          bytes,
          expectedHash: hash
        })
        if (!response.success || !response.hash) {
          const error = new Error(response.error || t(($) => $.editors.wordSaveFailed))
          if (response.conflict) error.name = 'DocxConflict'
          throw error
        }
        hash = response.hash
        saved = version
      }
      events.status('idle')
    })()
      .catch((error: Error) => {
        events.status(error.name === 'DocxConflict' ? 'conflict' : 'error', error.message)
        throw error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  const unregister =
    writable && filePath
      ? registerTextSave(filePath, {
          save: flush,
          pause: () => {
            paused = true
            editor.setDocumentMode('viewing')
          },
          resume: () => {
            paused = false
            editor.setDocumentMode('editing')
          },
          discard: () => {
            saved = revision
            paused = true
          }
        })
      : undefined
  let reloading = false
  let watchId: string | undefined
  const check = async () => {
    if (!filePath || disposed) return
    await pending?.catch(() => undefined)
    const version = hash
    const current = await sha256Hex(await window.api.readFile(filePath))
    if (disposed || reloading || version !== hash || current === hash) return
    if (revision !== saved)
      events.status(
        'conflict',
        t(($) => $.editors.wordConflict)
      )
    else {
      reloading = true
      events.reload(true)
    }
  }
  const recheck = () => {
    void check().catch((error: Error) => {
      if (!disposed) events.status('error', error.message)
    })
  }
  if (filePath) window.addEventListener('focus', recheck)
  const unsubscribe = filePath
    ? window.api.onFileWatchChange((e) => {
        if (e.watchId === watchId) recheck()
      })
    : undefined
  if (filePath)
    void window.api.fileWatchStart({ filePath }).then((r) => {
      if (!r.watchId) return
      if (disposed) void window.api.fileWatchStop({ watchId: r.watchId })
      else {
        watchId = r.watchId
        recheck()
      }
    })
  return {
    flush,
    copy: () =>
      editor.export({ triggerDownload: true, exportedName: t(($) => $.editors.wordCopyName) }),
    discard() {
      saved = revision
      events.reload()
    },
    close() {
      disposed = true
      window.removeEventListener('focus', recheck)
      observer?.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      unsubscribe?.()
      if (watchId) void window.api.fileWatchStop({ watchId })
      unregister?.()
      void flush()
        .then(() => editor.destroy())
        .catch(() => undefined)
    },
    editor
  }
}

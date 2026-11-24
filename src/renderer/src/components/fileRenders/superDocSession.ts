import 'superdoc/style.css'
import { prepareSuperDocReview } from './superDocReview'
import { t } from '../../i18n'
import { createOfficeAutosave, type DocumentSaveStatus } from './officeAutosave'
export type { DocumentSaveStatus } from './officeAutosave'

export async function openSuperDoc(
  host: HTMLElement,
  source: Blob,
  filePath: string | undefined,
  events: {
    review: boolean
    writable: boolean
    ready: () => void
    layout: () => void
    status: (value: DocumentSaveStatus, message?: string) => void
    reload: (external?: boolean) => void
  }
) {
  const writable = Boolean(
    events.writable && filePath && (await window.api.canWriteOfficeFile(filePath))
  )
  let ready = false,
    disposed = false
  const autosave =
    filePath && !events.review
      ? await createOfficeAutosave(
          filePath,
          new Uint8Array(await source.arrayBuffer()),
          async (expectedHash) =>
            window.api.writeOfficeFile({
              filePath,
              expectedHash,
              bytes: new Uint8Array(
                await (await editor.export({ triggerDownload: false })).arrayBuffer()
              )
            }),
          {
            ...events,
            readOnly: !writable,
            editable: (value) => editor.setDocumentMode(value && writable ? 'editing' : 'viewing')
          }
        )
      : undefined
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
      toolbar: false,
      comments: { panel: false, highlights: false },
      loading: false,
      // Only suppress the SDK surface/shortcut. ui.search still exposes the
      // shared host search engine used by our application-owned find strip.
      search: false
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
      autosave?.changed()
    }
  })
  return {
    flush: () => autosave?.flush() ?? Promise.resolve(),
    copy: () =>
      editor.export({ triggerDownload: true, exportedName: t(($) => $.editors.wordCopyName) }),
    discard: () => autosave?.discard(),
    close() {
      disposed = true
      observer?.disconnect()
      cancelAnimationFrame(frame)
      void (autosave?.close() ?? Promise.resolve())
        .then(() => editor.destroy())
        .catch(() => undefined)
    },
    editor,
    writable
  }
}

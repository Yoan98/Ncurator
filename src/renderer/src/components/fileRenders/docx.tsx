import { message } from 'antd'
import DocxToolbar, { DocxStatusBar } from './DocxToolbar'
import { captureWordView, restoreWordView, flashWordLocation, officeViews } from './officeViewState'
import { t } from '../../i18n'
import { useOfficeReviewNavigation } from '../workbench/OfficeReviewContext'
import { useCallback, useEffect, useState, useRef } from 'react'
import type { DocRendererProps } from 'react-doc-viewer'
import type { openSuperDoc, DocumentSaveStatus } from './superDocSession'
import './index.css'
import DocxSelectionLayer from './DocxSelectionLayer'
import { observeWordPointers } from './selection/superDocSelection'
import DocxOverviewRuler from './DocxOverviewRuler'
import type { SelectionTarget } from './selection/types'
import { workbenchSelectors } from '../../testing/selectors'
import type { LoadedFileRenderDocument } from './types'

const scrollToAnchor = (container: HTMLDivElement, anchorName?: string): void => {
  if (!anchorName) {
    delete container.dataset.currentAnchor
    delete container.dataset.lastScrolledAnchor
    return
  }
  container.dataset.currentAnchor = anchorName
  delete container.dataset.lastScrolledAnchor
  window.requestAnimationFrame(() => {
    const anchor = container.querySelector<HTMLElement>(`#${CSS.escape(anchorName)}`)
    if (!anchor) return
    container.dataset.lastScrolledAnchor = anchorName
    anchor.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    })
  })
}

export const DocxPreview = ({
  document: currentDocument
}: {
  document?: LoadedFileRenderDocument
}) => {
  const reviewNavigation = useOfficeReviewNavigation()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [renderedKey, setRenderedKey] = useState<string | null>(null)
  const [renderRevision, setRenderRevision] = useState(0)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [references, setReferences] = useState<SelectionTarget[]>([])
  const updateReferences = useCallback((next: SelectionTarget[]) => {
    setReferences((previous) => {
      // Selection geometry is refreshed on scroll. Keep the ruler's targets stable when
      // the same DOM ranges still represent the same saved references.
      const unchanged =
        previous.length === next.length &&
        previous.every((target, index) => {
          const candidate = next[index]
          const a = target.geometry.ranges || [],
            b = candidate.geometry.ranges || []
          return (
            target.node === candidate.node &&
            a.length === b.length &&
            a.every(
              (range, i) =>
                range.startContainer === b[i].startContainer &&
                range.startOffset === b[i].startOffset &&
                range.endContainer === b[i].endContainer &&
                range.endOffset === b[i].endOffset
            )
          )
        })
      return unchanged ? previous : next
    })
  }, [])
  const documentFile = currentDocument?.file
  const documentFileData = currentDocument?.fileData
  const documentUri = currentDocument?.uri
  const anchorName = currentDocument?.metadata?.anchorName
  const renderKey = [documentUri || '', currentDocument?.fileName || '', anchorName || ''].join(
    '\u0000'
  )

  const [pointers, setPointers] = useState<ReturnType<typeof observeWordPointers>>()
  const session = useRef<Awaited<ReturnType<typeof openSuperDoc>> | undefined>(undefined)
  const [generation, reload] = useState(0)
  const [saveStatus, setSaveStatus] = useState<DocumentSaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const filePath = currentDocument?.filePath
  const writable = Boolean(
    currentDocument?.editable &&
    filePath &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath) &&
    /\.docx$/i.test(filePath) &&
    currentDocument?.metadata?.docxOverview !== 'changes'
  )
  const onExternalReload = currentDocument?.metadata?.onExternalReload
  const viewKey =
    currentDocument?.metadata?.viewKey ||
    `${filePath}:${currentDocument?.metadata?.docxOverview || 'preview'}`
  const location = currentDocument?.metadata?.location
  const isReview = currentDocument?.metadata?.docxOverview === 'changes'
  useEffect(() => {
    if (!container) return
    const pointerObserver = observeWordPointers(container)
    setPointers(pointerObserver)
    let active = true
    let openedReady = false
    let restored = false
    let scrollFrame = 0
    const saveView = () => {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        if (openedReady && restored) captureWordView(container, viewKey, session.current?.editor)
      })
    }
    container.addEventListener('scroll', saveView)
    const host = document.createElement('div')
    container.replaceChildren(host)
    setRenderedKey(null)
    setRenderError(null)
    setSaveStatus('idle')
    const start = async () => {
      let blob: Blob
      if (filePath && !isReview && !/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath))
        blob = new Blob([Uint8Array.from(await window.api.readFile(filePath))])
      else if (documentFile) blob = documentFile
      else if (documentFileData instanceof Blob) blob = documentFileData
      else if (documentFileData instanceof ArrayBuffer) blob = new Blob([documentFileData])
      else if (documentUri) blob = await (await fetch(documentUri)).blob()
      else throw new Error(t(($) => $.editors.fileDeleted))
      const { openSuperDoc } = await import('./superDocSession')
      if (!active) return
      const opened = await openSuperDoc(
        host,
        blob,
        !isReview && filePath && !/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath) ? filePath : undefined,
        {
          review: isReview,
          writable,
          ready() {
            if (active) {
              openedReady = true
              setRenderedKey(renderKey)
              setRenderRevision((n) => n + 1)
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const editor = session.current?.editor
                  if (!active || !editor) return
                  restoreWordView(container, viewKey, editor)
                  if (anchorName) scrollToAnchor(container, anchorName)
                  restored = true
                  const target = officeViews.consume(viewKey, location)
                  if (target?.kind === 'docx' && !flashWordLocation(container, target))
                    message.info(t(($) => $.editors.changeNotFound))
                })
              )
            }
          },
          layout() {
            if (active) setRenderRevision((n) => n + 1)
          },
          status(value, message) {
            if (active) {
              if (!openedReady && value === 'error') {
                setRenderError(message || t(($) => $.editors.couldNotRenderTheWordDocument))
                return
              }
              setSaveStatus(value)
              setSaveMessage(message ?? '')
            }
          },
          reload(external) {
            if (!active) return
            reload((n) => n + 1)
            if (external) onExternalReload?.()
          }
        }
      )
      if (active) {
        session.current = opened
        setRenderRevision((n) => n + 1)
      } else opened.close()
    }
    void start().catch((e: Error) => {
      if (active) setRenderError(e.message)
    })
    return () => {
      if (openedReady && restored) captureWordView(container, viewKey, session.current?.editor)
      cancelAnimationFrame(scrollFrame)
      container.removeEventListener('scroll', saveView)
      active = false
      pointerObserver.close()
      session.current?.close()
      session.current = undefined
      host.remove()
    }
  }, [
    container,
    documentFile,
    documentFileData,
    documentUri,
    renderKey,
    anchorName,
    filePath,
    writable,
    generation,
    onExternalReload,
    isReview,
    viewKey,
    location
  ])

  useEffect(() => {
    if (!container || !reviewNavigation?.enabled) return
    let down: { x: number; y: number; id: number } | null = null
    const start = (event: PointerEvent) => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
    }
    const end = (event: PointerEvent) => {
      const origin = down
      down = null
      if (
        !origin ||
        origin.id !== event.pointerId ||
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5 ||
        !window.getSelection()?.isCollapsed
      )
        return
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-review-region]')
          : null
      if (element?.dataset.reviewRegion) reviewNavigation.navigate(element.dataset.reviewRegion)
    }
    container.addEventListener('pointerdown', start)
    container.addEventListener('pointerup', end)
    return () => {
      container.removeEventListener('pointerdown', start)
      container.removeEventListener('pointerup', end)
    }
  }, [container, reviewNavigation])

  if (!currentDocument) return null
  const ready = renderRevision > 0 && renderedKey === renderKey && !renderError

  return (
    <div
      className="relative flex h-full w-full min-w-0 flex-col bg-[var(--notion-surface-sunken)]"
      data-testid={workbenchSelectors.docxViewer}
    >
      <div
        data-testid={workbenchSelectors.docxToolbar}
        className="docx-toolbar min-w-0 shrink-0 border-b border-[var(--notion-line)] bg-[var(--notion-page)]"
      >
        <DocxToolbar
          editor={ready ? session.current?.editor : undefined}
          writable={Boolean(session.current?.writable)}
          container={container}
        />
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={setContainer}
          className={`docx-content h-full min-w-0 flex-1 overflow-auto px-3 py-3 ${currentDocument.metadata?.docxOverview ? 'docx-content-with-overview' : ''}`}
        />
        {!ready && !renderError && (
          <div
            data-testid={workbenchSelectors.docxLoading}
            role="status"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--notion-surface-sunken)] text-sm text-[var(--notion-text-soft)]"
          >
            {t(($) => $.editors.wordLoading)}
            <span
              className="docx-loading-track"
              role="progressbar"
              aria-label={t(($) => $.editors.wordLoading)}
            />
          </div>
        )}
        {currentDocument.metadata?.allowDocumentSelection && currentDocument.filePath && ready ? (
          <DocxSelectionLayer
            container={container}
            editor={session.current?.editor}
            pointers={pointers}
            filePath={currentDocument.filePath}
            revision={renderRevision}
            onTargetsChange={updateReferences}
          />
        ) : null}
        {currentDocument.metadata?.docxOverview ? (
          <DocxOverviewRuler
            key={renderKey}
            container={container}
            mode={currentDocument.metadata.docxOverview}
            revision={ready ? renderRevision : 0}
            references={references}
          />
        ) : null}
        {saveStatus === 'saving' && (
          <span
            role="status"
            aria-label={t(($) => $.editors.wordSaving)}
            className="absolute right-5 top-2 size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {(saveStatus === 'error' || saveStatus === 'conflict') && (
          <div
            role="alert"
            className="absolute bottom-2 left-2 rounded bg-[var(--notion-page)] p-2 shadow"
          >
            {saveMessage}{' '}
            {saveStatus === 'conflict' ? (
              <>
                <button onClick={() => void session.current?.copy()}>
                  {t(($) => $.editors.wordSaveCopy)}
                </button>{' '}
                <button onClick={() => session.current?.discard()}>
                  {t(($) => $.editors.wordReopen)}
                </button>
              </>
            ) : (
              <button onClick={() => void session.current?.flush().catch(() => undefined)}>
                {t(($) => $.common.retry)}
              </button>
            )}
          </div>
        )}
        {renderError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--notion-surface-sunken)] px-6 text-center text-sm text-[var(--notion-text-soft)]">
            <span className="max-w-[460px] whitespace-pre-wrap break-words">
              {t(($) => $.editors.wordPreviewFailed, { value1: renderError })}
              <button className="mt-3 block w-full" onClick={() => reload((n) => n + 1)}>
                {t(($) => $.common.retry)}
              </button>
            </span>
          </div>
        ) : null}
      </div>
      <DocxStatusBar editor={ready ? session.current?.editor : undefined} container={container} />
    </div>
  )
}

const CustomDocxRenderer = ({ mainState }: DocRendererProps) => (
  <DocxPreview document={mainState.currentDocument} />
)

CustomDocxRenderer.fileTypes = [
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
CustomDocxRenderer.weight = 1

export default CustomDocxRenderer

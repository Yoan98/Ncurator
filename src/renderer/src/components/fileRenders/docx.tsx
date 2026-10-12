import { useCallback, useEffect, useState } from 'react'
import type { DocRendererProps } from 'react-doc-viewer'
import '@js-preview/docx/lib/index.css'
import './index.css'
import DocxSelectionLayer from './DocxSelectionLayer'
import DocxOverviewRuler from './DocxOverviewRuler'
import type { SelectionTarget } from './selection/types'
import { workbenchSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import type { LoadedFileRenderDocument } from './types'

type BrowserProcessShim = {
  env: Record<string, string | undefined>
  browser: true
  version: string
  versions: Record<string, string>
  platform: 'browser'
  argv: string[]
  pid: number
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
  cwd: () => string
  emit: () => false
  on: () => BrowserProcessShim
  once: () => BrowserProcessShim
  off: () => BrowserProcessShim
  removeListener: () => BrowserProcessShim
}

let docxPreviewModulePromise: Promise<typeof import('@js-preview/docx')> | null = null

const ensureBrowserProcessShim = (): void => {
  const runtime = globalThis as unknown as { process?: unknown }
  if (runtime.process) return

  const shim = {} as BrowserProcessShim
  Object.assign(shim, {
    env: {},
    browser: true,
    version: '',
    versions: {},
    platform: 'browser',
    argv: [],
    pid: 0,
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
      queueMicrotask(() => callback(...args))
    },
    cwd: () => '/',
    emit: () => false,
    on: () => shim,
    once: () => shim,
    off: () => shim,
    removeListener: () => shim
  } satisfies BrowserProcessShim)

  Object.defineProperty(runtime, 'process', {
    configurable: true,
    value: shim,
    writable: true
  })
}

const loadDocxPreview = async (): Promise<(typeof import('@js-preview/docx'))['default']> => {
  ensureBrowserProcessShim()
  docxPreviewModulePromise ||= import('@js-preview/docx')
  return (await docxPreviewModulePromise).default
}

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

  useEffect(() => {
    if (!container || !currentDocument) return
    if (renderedKey === renderKey && container.childNodes.length > 0) {
      scrollToAnchor(container, anchorName)
      return
    }

    let cancelled = false
    const renderDocx = async (): Promise<void> => {
      setRenderError(null)
      let file = documentFile
      if (!file && documentFileData instanceof Blob) {
        file = documentFileData
      }
      if (!file && documentFileData instanceof ArrayBuffer) {
        file = new Blob([documentFileData], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        })
      }
      if (!file && documentUri) {
        try {
          const response = await fetch(documentUri)
          file = await response.blob()
        } catch (error) {
          console.error('Failed to fetch docx', error)
          if (!cancelled) {
            setRenderError(
              normalizeUserFacingError(
                error instanceof Error ? error.message : error,
                '读取 docx 预览数据失败'
              )
            )
          }
          return
        }
      }
      if (!file || cancelled) {
        if (!file && !cancelled) {
          setRenderError('缺少 docx 预览数据')
        }
        return
      }

      setRenderRevision(0)
      container.replaceChildren()
      const jsPreviewDocx = await loadDocxPreview()
      if (cancelled) return
      const previewer = jsPreviewDocx.init(container)
      try {
        await previewer.preview(file)
        if (!cancelled) {
          setRenderRevision((value) => value + 1)
          setRenderedKey(renderKey)
          scrollToAnchor(container, anchorName)
        }
      } catch (error) {
        console.error('Failed to render docx preview', error)
        if (!cancelled) {
          setRenderError(
            normalizeUserFacingError(
              error instanceof Error ? error.message : error,
              'docx 渲染失败'
            )
          )
        }
      }
    }

    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [
    anchorName,
    container,
    currentDocument,
    documentFile,
    documentFileData,
    documentUri,
    renderKey,
    renderedKey
  ])

  if (!currentDocument) return null
  const ready = renderRevision > 0 && renderedKey === renderKey && !renderError

  return (
    <div
      className="relative flex h-full w-full min-w-0 bg-[#F7F7F5]"
      data-testid={workbenchSelectors.docxViewer}
    >
      <div
        ref={setContainer}
        className="docx-content h-full min-w-0 flex-1 overflow-auto px-3 py-3"
      />
      {currentDocument.metadata?.allowDocumentSelection && currentDocument.filePath && ready ? (
        <DocxSelectionLayer
          container={container}
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
      {renderError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F7F7F5] px-6 text-center text-sm text-[#787774]">
          <span className="max-w-[460px] whitespace-pre-wrap break-words">
            {`docx 预览渲染失败：${renderError}`}
          </span>
        </div>
      ) : null}
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

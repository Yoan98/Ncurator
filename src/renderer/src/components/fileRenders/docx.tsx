import { useEffect, useRef } from 'react'
import jsPreviewDocx from '@js-preview/docx'
import type { DocRendererProps, IDocument } from 'react-doc-viewer'
import '@js-preview/docx/lib/index.css'
import './index.css'
import { workbenchSelectors } from '../../testing/selectors'

type DocViewerMetadata = {
  anchorName?: string
  pageNumber?: number
}

type DocViewerDocument = Omit<IDocument, 'fileData'> & {
  file?: File | Blob
  fileData?: string | ArrayBuffer | Blob | File
  metadata?: DocViewerMetadata
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

const CustomDocxRenderer = ({ mainState }: DocRendererProps) => {
  const currentDocument = mainState.currentDocument as DocViewerDocument | undefined
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !currentDocument) return

    let cancelled = false
    const renderDocx = async (): Promise<void> => {
      let file = currentDocument.file
      if (!file && currentDocument.fileData instanceof Blob) {
        file = currentDocument.fileData
      }
      if (!file && currentDocument.fileData instanceof ArrayBuffer) {
        file = new Blob([currentDocument.fileData], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        })
      }
      if (!file && currentDocument.uri) {
        try {
          const response = await fetch(currentDocument.uri)
          file = await response.blob()
        } catch (error) {
          console.error('Failed to fetch docx', error)
          return
        }
      }
      if (!file || cancelled) return

      container.innerHTML = ''
      const previewer = jsPreviewDocx.init(container)
      try {
        await previewer.preview(file)
        if (!cancelled) {
          scrollToAnchor(container, currentDocument.metadata?.anchorName)
        }
      } catch (error) {
        console.error('Failed to render docx preview', error)
      }
    }

    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [currentDocument])

  if (!currentDocument) return null

  return (
    <div
      ref={containerRef}
      className="docx-content h-full w-full overflow-auto bg-[#FAF9F5] px-3 py-3"
      data-testid={workbenchSelectors.docxViewer}
    />
  )
}

CustomDocxRenderer.fileTypes = [
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
CustomDocxRenderer.weight = 1

export default CustomDocxRenderer

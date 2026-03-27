import { useEffect, useRef } from 'react'
import jsPreviewDocx from '@js-preview/docx'
import '@js-preview/docx/lib/index.css'
import './index.css'

type DocViewerMetadata = {
  anchorName?: string
  pageNumber?: number
}

type DocViewerDocument = {
  file?: File | Blob
  uri?: string
  metadata?: DocViewerMetadata
}

type DocViewerMainState = {
  currentDocument?: DocViewerDocument | null
}

type CustomDocxRendererProps = {
  mainState: DocViewerMainState
}

const scrollToAnchor = (container: HTMLDivElement, anchorName?: string): void => {
  if (!anchorName) return
  window.requestAnimationFrame(() => {
    const anchor = container.querySelector<HTMLElement>(`#${CSS.escape(anchorName)}`)
    if (!anchor) return
    anchor.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    })
  })
}

const CustomDocxRenderer = ({ mainState }: CustomDocxRendererProps) => {
  const { currentDocument } = mainState
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !currentDocument) return

    let cancelled = false
    const renderDocx = async (): Promise<void> => {
      let file = currentDocument.file
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
      const previewer = jsPreviewDocx.init(container, {
        renderChanges: true,
        inWrapper: true,
        ignoreWidth: true,
        ignoreHeight: true
      })
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
      className="docx-content h-full w-full overflow-auto bg-[#F8F7F4] px-3 py-3"
    />
  )
}

CustomDocxRenderer.fileTypes = [
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
CustomDocxRenderer.weight = 1

export default CustomDocxRenderer

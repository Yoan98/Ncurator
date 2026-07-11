import { useEffect, useRef, useState } from 'react'
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
  fileName?: string
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
  const lastRenderedKeyRef = useRef<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const documentFile = currentDocument?.file
  const documentFileData = currentDocument?.fileData
  const documentUri = currentDocument?.uri
  const anchorName = currentDocument?.metadata?.anchorName
  const renderKey = [documentUri || '', currentDocument?.fileName || '', anchorName || ''].join(
    '\u0000'
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !currentDocument) return
    if (lastRenderedKeyRef.current === renderKey && container.childNodes.length > 0) {
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
            setRenderError(error instanceof Error ? error.message : '读取 docx 预览数据失败')
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

      container.innerHTML = ''
      const previewer = jsPreviewDocx.init(container)
      try {
        await previewer.preview(file)
        if (!cancelled) {
          lastRenderedKeyRef.current = renderKey
          scrollToAnchor(container, anchorName)
        }
      } catch (error) {
        console.error('Failed to render docx preview', error)
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : 'docx 渲染失败')
        }
      }
    }

    void renderDocx()
    return () => {
      cancelled = true
    }
  }, [anchorName, currentDocument, documentFile, documentFileData, documentUri, renderKey])

  if (!currentDocument) return null

  return (
    <div
      className="relative h-full w-full bg-[#F7F7F5]"
      data-testid={workbenchSelectors.docxViewer}
    >
      <div ref={containerRef} className="docx-content h-full w-full overflow-auto px-3 py-3" />
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

CustomDocxRenderer.fileTypes = [
  'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
CustomDocxRenderer.weight = 1

export default CustomDocxRenderer

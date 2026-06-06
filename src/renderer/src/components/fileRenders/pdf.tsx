import { useState, useEffect, useMemo, useRef } from 'react'
import { pdfjs, Document, Page } from 'react-pdf'
import { Pagination } from 'antd'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocRenderer, DocRendererProps } from 'react-doc-viewer'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type { LoadedFileRenderDocument } from './types'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const createPageNumbers = (numPages: number): number[] => {
  return Array.from({ length: numPages }, (_, index) => index + 1)
}

const clampPageNumber = (pageNumber: number, numPages: number): number => {
  if (numPages <= 0) return 1
  return Math.min(Math.max(pageNumber, 1), numPages)
}

const CustomPDFRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const currentDocument = mainState.currentDocument as LoadedFileRenderDocument | undefined
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const pageNumbers = useMemo(() => createPageNumbers(numPages), [numPages])

  useEffect(() => {
    setNumPages(0)
    setPageNumber(currentDocument?.metadata?.pageNumber || 1)
    pageRefs.current = {}
  }, [currentDocument])

  useEffect(() => {
    if (numPages <= 0) return
    const targetPage = clampPageNumber(pageNumber, numPages)
    if (targetPage !== pageNumber) {
      setPageNumber(targetPage)
      return
    }

    window.requestAnimationFrame(() => {
      pageRefs.current[targetPage]?.scrollIntoView({
        block: 'start',
        inline: 'nearest'
      })
    })
  }, [numPages, pageNumber])

  if (!currentDocument) return null

  const file =
    currentDocument.fileData instanceof Uint8Array ||
    currentDocument.fileData instanceof ArrayBuffer
      ? { data: currentDocument.fileData }
      : currentDocument.uri || currentDocument.file

  if (!file) return null

  const onDocumentLoadSuccess = (pdf: PDFDocumentProxy): void => {
    setNumPages(pdf.numPages)
  }

  const onDocumentLoadError = (error: Error): void => {
    console.error('Failed to render PDF preview', error)
  }

  const onPageChange = (page: number): void => {
    setPageNumber(clampPageNumber(page, numPages))
  }

  return (
    <div
      id="my-pdf-renderer"
      ref={scrollContainerRef}
      className="relative h-full w-full overflow-auto bg-[#F0EFEB] p-4"
    >
      <Document
        file={file}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="flex h-full items-center justify-center text-[#9C9A94]">
            Loading PDF...
          </div>
        }
        className="mx-auto flex w-fit flex-col items-center gap-4 pb-20"
      >
        {pageNumbers.map((page) => (
          <div
            key={page}
            ref={(element) => {
              pageRefs.current[page] = element
            }}
            data-pdf-page={page}
            className="shadow-lg"
          >
            <Page
              pageNumber={page}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              scale={1.0}
            />
          </div>
        ))}
        {numPages > 1 && (
          <div className="sticky bottom-4 left-1/2 z-10 w-fit min-w-[200px] -translate-x-1/2 rounded-full bg-white/80 p-2 opacity-20 shadow-md backdrop-blur-sm transition-opacity duration-300 hover:opacity-100">
            <Pagination
              current={pageNumber}
              total={numPages}
              onChange={onPageChange}
              simple
              pageSize={1}
              showSizeChanger={false}
            />
          </div>
        )}
      </Document>
    </div>
  )
}

CustomPDFRenderer.fileTypes = ['pdf', 'application/pdf']
CustomPDFRenderer.weight = 1

export default CustomPDFRenderer

import { useState, useEffect } from 'react'
import { pdfjs, Document, Page } from 'react-pdf'
import { Pagination } from 'antd'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocRenderer, DocRendererProps } from 'react-doc-viewer'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type { LoadedFileRenderDocument } from './types'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const CustomPDFRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const currentDocument = mainState.currentDocument as LoadedFileRenderDocument | undefined
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)

  useEffect(() => {
    if (currentDocument?.metadata?.pageNumber) {
      setPageNumber(currentDocument.metadata.pageNumber)
    }
  }, [currentDocument])

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
    setPageNumber(page)
  }

  return (
    <div
      id="my-pdf-renderer"
      className="relative flex justify-center bg-gray-100/50 p-4 h-full w-full overflow-auto"
    >
      <Document
        file={file}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="flex items-center justify-center h-full text-gray-400">
            Loading PDF...
          </div>
        }
        className="shadow-lg"
      >
        <Page
          pageNumber={pageNumber}
          renderTextLayer={true}
          renderAnnotationLayer={true}
          scale={1.0}
          className="mb-4"
        />
        {numPages > 1 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 min-w-[200px] z-10 opacity-20 hover:opacity-100 transition-opacity duration-300 bg-white/80 backdrop-blur-sm rounded-full p-2 shadow-md">
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

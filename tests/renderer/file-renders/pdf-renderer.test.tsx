import React, { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CustomPDFRenderer from '../../../src/renderer/src/components/fileRenders/pdf'

type MockDocumentProps = {
  children: React.ReactNode
  onLoadSuccess: (pdf: { numPages: number }) => void
}

type MockPageProps = {
  pageNumber: number
}

vi.mock('react-pdf', () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: ''
    }
  },
  Document: ({ children, onLoadSuccess }: MockDocumentProps) => {
    useEffect(() => {
      onLoadSuccess({ numPages: 3 })
    }, [onLoadSuccess])

    return <div data-testid="mock-pdf-document">{children}</div>
  },
  Page: ({ pageNumber }: MockPageProps) => (
    <div data-testid="mock-pdf-page">PDF page {pageNumber}</div>
  )
}))

describe('CustomPDFRenderer', () => {
  it('renders the full PDF and scrolls to the chunk page', async () => {
    const scrollIntoView = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback): number => {
        callback(0)
        return 1
      }
    })

    render(
      <CustomPDFRenderer
        mainState={{
          currentFileNo: 0,
          documents: [],
          currentDocument: {
            uri: 'blob:ncurator-pdf-preview',
            fileType: 'pdf',
            fileData: new ArrayBuffer(8),
            metadata: { pageNumber: 2 }
          }
        }}
      />
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('mock-pdf-page')).toHaveLength(3)
    })
    expect(screen.getByText('PDF page 1')).toBeTruthy()
    expect(screen.getByText('PDF page 2')).toBeTruthy()
    expect(screen.getByText('PDF page 3')).toBeTruthy()

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled()
    })
    expect(scrollIntoView.mock.instances[0]?.getAttribute('data-pdf-page')).toBe('2')
  })
})

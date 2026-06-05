import { describe, expect, it, vi } from 'vitest'
import { prepareFileRenderDocument } from '../../../src/renderer/src/components/fileRenders/utils'

const createPdfBytes = (): Uint8Array => {
  return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
}

describe('file render PDF preview preparation', () => {
  it('loads local PDF files as byte data for pdf.js rendering', async () => {
    const pdfBytes = createPdfBytes()
    const readFile = vi.fn<[string], Promise<Uint8Array>>().mockResolvedValue(pdfBytes)
    const createdUrls: string[] = []

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        readFile
      }
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:ncurator-pdf-preview')
    })

    const document = await prepareFileRenderDocument(
      {
        filePath: '/workspace/学习笔记/深度学习.pdf'
      },
      createdUrls
    )

    expect(readFile).toHaveBeenCalledWith('/workspace/学习笔记/深度学习.pdf')
    expect(document?.fileType).toBe('pdf')
    expect(document?.uri).toBe('blob:ncurator-pdf-preview')
    expect(document?.fileData).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(document?.fileData as ArrayBuffer)).toEqual(pdfBytes)
    expect(createdUrls).toEqual(['blob:ncurator-pdf-preview'])
  })
})

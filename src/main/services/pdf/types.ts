export type PdfDocumentMetadata = {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
}

export type PdfOutlineItem = {
  title: string
  pageNumber?: number
  depth: number
}

export type PdfOpenResult = {
  docId: string
  sourcePath: string
  pageCount: number
  metadata: PdfDocumentMetadata
  outline: PdfOutlineItem[]
  encrypted: boolean
}

export type PdfPageTextStatus = 'available' | 'empty' | 'suspicious'

export type PdfPageReadResult = {
  pageNumber: number
  text: string
  charCount: number
  textStatus: PdfPageTextStatus
  imageCount: number
  width: number
  height: number
  rotation: number
}

export type PdfSearchMode = 'literal' | 'regex'

export type PdfSearchMatch = {
  pageNumber: number
  matchedText: string
  snippet: string
  start: number
  end: number
}

export type PdfRenderedImage = {
  pageNumber: number
  path: string
  mimeType: 'image/png'
  width: number
  height: number
}

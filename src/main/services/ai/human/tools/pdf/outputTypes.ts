export type PdfMetadataOutput = {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
}

export type PdfOutlineItemOutput = {
  title: string
  pageNumber?: number
  depth: number
}

export type PdfOutlineOutput = {
  pageCount: number
  metadata: PdfMetadataOutput
  outline: PdfOutlineItemOutput[]
}

export type PdfSearchMatchOutput = {
  pageNumber: number
  matchedText: string
  snippet: string
  start: number
  end: number
}

export type PdfSearchOutput = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: PdfSearchMatchOutput[]
  pagesWithNoTextCount: number
  pagesWithSuspiciousTextCount: number
}

export type PdfPageOutput = {
  pageNumber: number
  text: string
  textStatus: 'available' | 'empty' | 'suspicious'
  imageCount: number
  pageImagePath: string
}

export type PdfReadPagesOutput = {
  pages: PdfPageOutput[]
}

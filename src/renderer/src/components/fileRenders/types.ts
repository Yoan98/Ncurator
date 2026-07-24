import type { IDocument } from 'react-doc-viewer'

export type FileRenderMetadata = {
  pageNumber?: number
  anchorName?: string
}

export type FileRenderDocument = {
  uri?: string
  fileType?: string
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  file?: File | Blob
}

export type LoadedFileRenderDocument = IDocument & {
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  file?: File | Blob
}

export type UnsupportedFileRenderDocument = {
  status: 'unsupported'
  fileName: string
  fileType: string
}

export type PreparedFileRenderDocument =
  | {
      status: 'ready'
      document: LoadedFileRenderDocument
    }
  | UnsupportedFileRenderDocument

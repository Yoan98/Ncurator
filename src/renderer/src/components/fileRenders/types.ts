import type { IDocument } from 'react-doc-viewer'

export type FileRenderMetadata = {
  pageNumber?: number
  anchorName?: string
  allowDocumentSelection?: boolean
}

export type FileRenderDocument = {
  uri?: string
  fileType?: string
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  contentRevision?: number
  file?: File | Blob
  /** 标记该文档是否允许应用内所见即所得编辑（仅真实本地文件使用，AI 修改快照不设置）。 */
  editable?: boolean
}

export type LoadedFileRenderDocument = IDocument & {
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  file?: File | Blob
  editable?: boolean
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

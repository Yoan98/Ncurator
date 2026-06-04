import React, { useEffect, useState } from 'react'
import { Empty, Modal, Spin } from 'antd'
import DocViewer, { DocViewerRenderers } from 'react-doc-viewer'
import type { IDocument } from 'react-doc-viewer'
import CustomPDFRenderer from './pdf'
import CustomMarkdownRenderer from './markdown'
import CustomDocxRenderer from './docx'

export type FileRenderMetadata = {
  pageNumber?: number
  anchorName?: string
}

export type FileRenderDocument = {
  uri?: string
  fileType?: string
  fileData?: string | ArrayBuffer | Blob | File
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  file?: File | Blob
}

type LoadedFileRenderDocument = IDocument & {
  fileName?: string
  filePath?: string
  metadata?: FileRenderMetadata
  file?: File | Blob
}

type FileRenderViewerProps = {
  documents: FileRenderDocument[]
  emptyText?: string
  className?: string
}

type FileRenderProps = {
  open: boolean
  documents: FileRenderDocument[]
  onCancel: () => void
  title?: string
  modalTestId?: string
}

const getMimeType = (filename: string): string => {
  const extension = filename.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'md':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

const getFileType = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || ''
}

const getFileName = (document: FileRenderDocument): string => {
  if (document.fileName) return document.fileName
  if (document.file instanceof File && document.file.name) return document.file.name
  if (document.fileData instanceof File && document.fileData.name) return document.fileData.name
  if (document.filePath) {
    const parts = document.filePath.split(/[\\/]/)
    return parts[parts.length - 1] || 'document'
  }
  return 'document'
}

const createFileFromBlob = (blob: Blob, fileName: string): File => {
  return blob instanceof File
    ? blob
    : new File([blob], fileName, {
        type: blob.type || getMimeType(fileName)
      })
}

const createObjectUrl = (file: File, createdUrls: string[]): string => {
  const objectUrl = URL.createObjectURL(file)
  createdUrls.push(objectUrl)
  return objectUrl
}

const getSerializableFileData = (
  fileData: FileRenderDocument['fileData']
): string | ArrayBuffer | undefined => {
  if (typeof fileData === 'string' || fileData instanceof ArrayBuffer) {
    return fileData
  }
  return undefined
}

const prepareDocument = async (
  document: FileRenderDocument,
  createdUrls: string[]
): Promise<LoadedFileRenderDocument | null> => {
  const fileName = getFileName(document)
  const fileType = document.fileType || getFileType(fileName)
  const fileData = getSerializableFileData(document.fileData)
  const sourceBlob =
    document.file instanceof Blob
      ? document.file
      : document.fileData instanceof Blob
        ? document.fileData
        : null

  if (sourceBlob) {
    const file = createFileFromBlob(sourceBlob, fileName)
    return {
      ...document,
      uri: document.uri || createObjectUrl(file, createdUrls),
      fileData,
      fileName,
      fileType,
      file,
      metadata: document.metadata
    }
  }

  if (document.filePath) {
    const buffer = await window.api.readFile(document.filePath)
    const file = new File([new Uint8Array(buffer)], fileName, {
      type: getMimeType(fileName)
    })
    return {
      ...document,
      uri: createObjectUrl(file, createdUrls),
      fileData,
      fileName,
      fileType,
      file,
      metadata: document.metadata
    }
  }

  if (document.uri) {
    return {
      uri: document.uri,
      fileType,
      fileData,
      fileName,
      filePath: document.filePath,
      metadata: document.metadata
    }
  }

  return {
    uri: '',
    fileType,
    fileData,
    fileName,
    filePath: document.filePath,
    metadata: document.metadata
  }
}

const usePreparedDocuments = (
  documents: FileRenderDocument[]
): { documents: LoadedFileRenderDocument[]; loading: boolean } => {
  const [loadedDocuments, setLoadedDocuments] = useState<LoadedFileRenderDocument[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let createdUrls: string[] = []

    const cleanupUrls = (): void => {
      createdUrls.forEach((url) => URL.revokeObjectURL(url))
      createdUrls = []
    }

    if (documents.length === 0) {
      cleanupUrls()
      setLoadedDocuments([])
      setLoading(false)
      return cleanupUrls
    }

    let cancelled = false

    const loadDocuments = async (): Promise<void> => {
      setLoading(true)
      cleanupUrls()

      try {
        const preparedDocuments = await Promise.all(
          documents.map((document) => prepareDocument(document, createdUrls))
        )
        const validDocuments = preparedDocuments.filter(
          (document): document is LoadedFileRenderDocument => document !== null && Boolean(document.uri)
        )
        if (!cancelled) {
          setLoadedDocuments(validDocuments)
        } else {
          cleanupUrls()
        }
      } catch (error) {
        console.error('Failed to load file preview', error)
        if (!cancelled) {
          setLoadedDocuments([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadDocuments()

    return () => {
      cancelled = true
      cleanupUrls()
    }
  }, [documents])

  return {
    documents: loadedDocuments,
    loading
  }
}

const renderers = [CustomPDFRenderer, CustomMarkdownRenderer, CustomDocxRenderer, ...DocViewerRenderers]

export const FileRenderViewer: React.FC<FileRenderViewerProps> = ({
  documents,
  emptyText = '选择一个文件后在这里查看内容。',
  className
}) => {
  const { documents: loadedDocuments, loading } = usePreparedDocuments(documents)

  if (documents.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center rounded-2xl border border-dashed border-[#E5E5E4] bg-[#FAFAF9] ${
          className || ''
        }`}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-[#666666]">{emptyText}</span>}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className={`flex h-full items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white ${
          className || ''
        }`}
      >
        <Spin size="large" />
      </div>
    )
  }

  if (loadedDocuments.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white ${
          className || ''
        }`}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="文件暂时无法预览" />
      </div>
    )
  }

  return (
    <div
      className={`h-full overflow-hidden rounded-2xl border border-[#E5E5E4] bg-white ${
        className || ''
      }`}
    >
      <DocViewer
        className="h-full w-full"
        style={{ height: '100%', width: '100%' }}
        documents={loadedDocuments}
        pluginRenderers={renderers}
        config={{
          header: {
            disableHeader: true,
            disableFileName: true,
            retainURLParams: false
          }
        }}
      />
    </div>
  )
}

const FileRender: React.FC<FileRenderProps> = ({
  open,
  documents,
  onCancel,
  title,
  modalTestId
}) => {
  return (
    <Modal
      className="file-preview-modal"
      width="72vw"
      styles={{ body: { height: '72vh', minHeight: 480, padding: 4, overflow: 'hidden' } }}
      destroyOnClose
      footer={null}
      title={title || documents[0]?.fileName || '文件预览'}
      open={open}
      onCancel={onCancel}
      data-testid={modalTestId}
    >
      <FileRenderViewer documents={documents} />
    </Modal>
  )
}

export default FileRender

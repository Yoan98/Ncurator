import React, { useEffect, useRef, useState } from 'react'
import { Empty, Modal, Spin } from 'antd'
import DocViewer from 'react-doc-viewer'
import CustomPDFRenderer from './pdf'
import { CustomMarkdownRenderer, CustomPlainTextRenderer } from './markdown'
import CustomDocxRenderer from './docx'
import CustomPptxRenderer from './pptx'
import CustomImageRenderer from './image'
import CustomXlsxRenderer from './xlsx'
import { prepareFileRenderDocument } from './utils'
import { FILE_PREVIEW_SUPPORT_SUMMARY, getPreviewTypeLabel } from './capabilities'
import type {
  FileRenderDocument,
  LoadedFileRenderDocument,
  UnsupportedFileRenderDocument
} from './types'
export type { FileRenderDocument, FileRenderMetadata } from './types'

type FileRenderViewerProps = {
  documents: FileRenderDocument[]
  emptyText?: string
  className?: string
  framed?: boolean
}

type FileRenderProps = {
  open: boolean
  documents: FileRenderDocument[]
  onCancel: () => void
  title?: string
  modalTestId?: string
}

const getDocumentsSignature = (documents: FileRenderDocument[]): string =>
  documents
    .map((document) =>
      [
        document.filePath,
        document.fileName,
        document.uri,
        document.fileType,
        document.contentRevision,
        document.metadata ? JSON.stringify(document.metadata) : ''
      ].join('\u0000')
    )
    .join('\u0001')

const getPreviewErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'

const usePreparedDocuments = (
  documents: FileRenderDocument[]
): {
  documents: LoadedFileRenderDocument[]
  loading: boolean
  errorMessage: string | null
  unsupportedDocument: UnsupportedFileRenderDocument | null
} => {
  const [loadedDocuments, setLoadedDocuments] = useState<LoadedFileRenderDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [unsupportedDocument, setUnsupportedDocument] =
    useState<UnsupportedFileRenderDocument | null>(null)
  const latestDocumentsRef = useRef(documents)
  const lastSignatureRef = useRef('')
  const documentsSignature = getDocumentsSignature(documents)

  if (lastSignatureRef.current !== documentsSignature) {
    lastSignatureRef.current = documentsSignature
    latestDocumentsRef.current = documents
  }

  useEffect(() => {
    const documentsToLoad = latestDocumentsRef.current
    let createdUrls: string[] = []

    const cleanupUrls = (): void => {
      createdUrls.forEach((url) => URL.revokeObjectURL(url))
      createdUrls = []
    }

    if (documentsToLoad.length === 0) {
      cleanupUrls()
      setLoadedDocuments([])
      setLoading(false)
      setErrorMessage(null)
      setUnsupportedDocument(null)
      return cleanupUrls
    }

    let cancelled = false

    const loadDocuments = async (): Promise<void> => {
      setLoading(true)
      setErrorMessage(null)
      setUnsupportedDocument(null)
      cleanupUrls()

      try {
        const preparedDocuments = await Promise.all(
          documentsToLoad.map((document) => prepareFileRenderDocument(document, createdUrls))
        )
        const validDocuments = preparedDocuments
          .filter((result) => result.status === 'ready')
          .map((result) => result.document)
          .filter((document) => Boolean(document.uri))
        const firstUnsupported =
          preparedDocuments.find((result) => result.status === 'unsupported') || null
        if (!cancelled) {
          setLoadedDocuments(validDocuments)
          setUnsupportedDocument(firstUnsupported)
          setErrorMessage(null)
        } else {
          cleanupUrls()
        }
      } catch (error) {
        console.error('Failed to load file preview', error)
        if (!cancelled) {
          setLoadedDocuments([])
          setUnsupportedDocument(null)
          setErrorMessage(getPreviewErrorMessage(error))
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
  }, [documentsSignature])

  return {
    documents: loadedDocuments,
    loading,
    errorMessage,
    unsupportedDocument
  }
}

const renderers = [
  CustomPDFRenderer,
  CustomMarkdownRenderer,
  CustomPlainTextRenderer,
  CustomDocxRenderer,
  CustomPptxRenderer,
  CustomImageRenderer,
  CustomXlsxRenderer
]

const FileRenderViewerBase: React.FC<FileRenderViewerProps> = ({
  documents,
  emptyText = '选择一个文件后在这里查看内容。',
  className,
  framed = true
}) => {
  const {
    documents: loadedDocuments,
    loading,
    errorMessage,
    unsupportedDocument
  } = usePreparedDocuments(documents)
  const surfaceClassName = framed
    ? `rounded-[8px] border border-[#EEEEEC] bg-white ${className || ''}`
    : `bg-white ${className || ''}`

  if (documents.length === 0) {
    return (
      <div
        className={`flex h-full items-center justify-center ${
          framed ? 'rounded-[8px] border border-dashed border-[#EEEEEC] bg-[#F4F4F2]' : 'bg-white'
        } ${className || ''}`}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-[#787774]">{emptyText}</span>}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className={`flex h-full items-center justify-center ${
          framed ? 'rounded-[8px] border border-[#EEEEEC] bg-white' : 'bg-white'
        } ${className || ''}`}
      >
        <Spin size="large" />
      </div>
    )
  }

  if (loadedDocuments.length === 0) {
    const unsupportedType = unsupportedDocument
      ? getPreviewTypeLabel(unsupportedDocument.fileName, unsupportedDocument.fileType)
      : null
    return (
      <div
        className={`flex h-full items-center justify-center ${
          framed ? 'rounded-[8px] border border-[#EEEEEC] bg-white' : 'bg-white'
        } ${className || ''}`}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="max-w-[420px] whitespace-pre-wrap break-words text-[#787774]">
              {errorMessage
                ? `文件暂时无法预览：${errorMessage}`
                : unsupportedType
                  ? `${unsupportedType} 文件暂不支持预览。\n${FILE_PREVIEW_SUPPORT_SUMMARY}`
                  : '文件暂时无法预览'}
            </span>
          }
        />
      </div>
    )
  }

  return (
    <div className={`h-full overflow-hidden ${surfaceClassName}`}>
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

export const FileRenderViewer = React.memo(
  FileRenderViewerBase,
  (previous, next) =>
    previous.emptyText === next.emptyText &&
    previous.className === next.className &&
    previous.framed === next.framed &&
    getDocumentsSignature(previous.documents) === getDocumentsSignature(next.documents)
)

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

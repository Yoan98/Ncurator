import React, { useEffect, useRef, useState } from 'react'
import { Empty, Modal, Spin } from 'antd'
import DocViewer, { DocViewerRenderers } from 'react-doc-viewer'
import CustomPDFRenderer from './pdf'
import { CustomMarkdownRenderer, CustomPlainTextRenderer } from './markdown'
import CustomDocxRenderer from './docx'
import { prepareFileRenderDocument } from './utils'
import type { FileRenderDocument, LoadedFileRenderDocument } from './types'
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

const usePreparedDocuments = (
  documents: FileRenderDocument[]
): { documents: LoadedFileRenderDocument[]; loading: boolean } => {
  const [loadedDocuments, setLoadedDocuments] = useState<LoadedFileRenderDocument[]>([])
  const [loading, setLoading] = useState(false)
  const latestDocumentsRef = useRef(documents)
  const lastSignatureRef = useRef('')
  const documentsSignature = documents
    .map((document) =>
      [
        document.filePath,
        document.fileName,
        document.metadata ? JSON.stringify(document.metadata) : ''
      ].join('\u0000')
    )
    .join('\u0001')

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
      return cleanupUrls
    }

    let cancelled = false

    const loadDocuments = async (): Promise<void> => {
      setLoading(true)
      cleanupUrls()

      try {
        const preparedDocuments = await Promise.all(
          documentsToLoad.map((document) => prepareFileRenderDocument(document, createdUrls))
        )
        const validDocuments = preparedDocuments.filter(
          (document): document is LoadedFileRenderDocument =>
            document !== null && Boolean(document.uri)
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
  }, [documentsSignature])

  return {
    documents: loadedDocuments,
    loading
  }
}

const renderers = [
  CustomPDFRenderer,
  CustomMarkdownRenderer,
  CustomPlainTextRenderer,
  CustomDocxRenderer,
  ...DocViewerRenderers
]

export const FileRenderViewer: React.FC<FileRenderViewerProps> = ({
  documents,
  emptyText = '选择一个文件后在这里查看内容。',
  className,
  framed = true
}) => {
  const { documents: loadedDocuments, loading } = usePreparedDocuments(documents)
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
    return (
      <div
        className={`flex h-full items-center justify-center ${
          framed ? 'rounded-[8px] border border-[#EEEEEC] bg-white' : 'bg-white'
        } ${className || ''}`}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="文件暂时无法预览" />
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

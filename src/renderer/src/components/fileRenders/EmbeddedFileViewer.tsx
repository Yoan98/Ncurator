import React, { useEffect, useRef, useState } from 'react'
import { Empty, Spin } from 'antd'
import DocViewer, { DocViewerRenderers } from 'react-doc-viewer'
import type { IDocument } from 'react-doc-viewer'
import CustomDocxRenderer from './docx'
import CustomMarkdownRenderer from './markdown'
import CustomPDFRenderer from './pdf'

type EmbeddedFileViewerDocument = IDocument & {
  fileName?: string
  filePath?: string
  metadata?: {
    pageNumber?: number
    anchorName?: string
  }
  file?: File | Blob
}

type EmbeddedFileViewerProps = {
  filePath?: string
  fileName?: string
  pageNumber?: number
  anchorName?: string
  emptyText?: string
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

const EmbeddedFileViewer: React.FC<EmbeddedFileViewerProps> = ({
  filePath,
  fileName,
  pageNumber,
  anchorName,
  emptyText = '选择一个文件后在这里查看内容。'
}) => {
  const [loading, setLoading] = useState(false)
  const [document, setDocument] = useState<EmbeddedFileViewerDocument | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const loadDocument = async (): Promise<void> => {
      if (!filePath || !fileName) {
        setDocument(null)
        return
      }

      setLoading(true)
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }

      try {
        const buffer = await window.api.readFile(filePath)
        const blob = new Blob([new Uint8Array(buffer)], {
          type: getMimeType(fileName)
        })
        const file = new File([blob], fileName, {
          type: getMimeType(fileName)
        })
        const objectUrl = URL.createObjectURL(file)
        objectUrlRef.current = objectUrl
        setDocument({
          uri: objectUrl,
          file,
          fileName,
          filePath,
          fileType: getFileType(fileName),
          metadata:
            pageNumber || anchorName
              ? {
                  ...(pageNumber ? { pageNumber } : {}),
                  ...(anchorName ? { anchorName } : {})
                }
              : undefined
        })
      } catch (error) {
        console.error('Failed to load file preview', error)
        setDocument(null)
      } finally {
        setLoading(false)
      }
    }

    void loadDocument()
  }, [anchorName, fileName, filePath, pageNumber])

  if (!filePath || !fileName) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#E5E5E4] bg-[#FAFAF9]">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span className="text-[#666666]">{emptyText}</span>}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white">
        <Spin size="large" />
      </div>
    )
  }

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-[#E5E5E4] bg-white">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="文件暂时无法预览" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-[#E5E5E4] bg-white">
      <DocViewer
        className="h-full w-full"
        style={{ height: '100%', width: '100%' }}
        documents={[document]}
        pluginRenderers={[
          CustomPDFRenderer,
          CustomMarkdownRenderer,
          CustomDocxRenderer,
          ...DocViewerRenderers
        ]}
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

export default EmbeddedFileViewer

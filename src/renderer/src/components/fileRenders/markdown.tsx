import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Empty, Spin } from 'antd'
import { arrayBufferFileLoader, type DocRenderer, type DocRendererProps } from 'react-doc-viewer'
import MarkdownRenderer from '../MarkdownRenderer'
import MarkdownEditor from './MarkdownEditor'
import PlainTextEditor from './PlainTextEditor'
import LineNumberOverlay from './LineNumberOverlay'
import { countLines } from './lineNumbers'
import type { LoadedFileRenderDocument } from './types'
import { workbenchSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

const TEXT_PREVIEW_MAX_CHARS = 500_000

type TextLoadState = {
  loading: boolean
  text: string
  error: string | null
}

const decodeUtf8 = (buffer: ArrayBuffer): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(buffer)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const loadDocumentText = async (document: LoadedFileRenderDocument): Promise<string> => {
  if (typeof document.fileData === 'string') {
    if (document.fileData.startsWith('data:')) {
      const response = await fetch(document.fileData)
      return decodeUtf8(await response.arrayBuffer())
    }
    return document.fileData
  }

  if (document.fileData instanceof Uint8Array) {
    return decodeUtf8(toArrayBuffer(document.fileData))
  }

  if (document.fileData instanceof ArrayBuffer) {
    return decodeUtf8(document.fileData)
  }

  if (document.file instanceof Blob) {
    return decodeUtf8(await document.file.arrayBuffer())
  }

  if (document.uri) {
    const response = await fetch(document.uri)
    if (!response.ok) {
      throw new Error(`Failed to fetch document: ${response.status}`)
    }
    return decodeUtf8(await response.arrayBuffer())
  }

  return ''
}

const useDocumentText = (document: LoadedFileRenderDocument | undefined): TextLoadState => {
  const [state, setState] = useState<TextLoadState>({
    loading: false,
    text: '',
    error: null
  })

  useEffect(() => {
    if (!document) {
      setState({ loading: false, text: '', error: null })
      return
    }

    let cancelled = false
    setState({ loading: true, text: '', error: null })

    void loadDocumentText(document)
      .then((text) => {
        if (!cancelled) {
          setState({ loading: false, text, error: null })
        }
      })
      .catch((error) => {
        console.error('Failed to load text preview', error)
        if (!cancelled) {
          setState({
            loading: false,
            text: '',
            error: normalizeUserFacingError(
              error instanceof Error ? error.message : error,
              '文本预览加载失败'
            )
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [document])

  return state
}

const TextPreviewScaffold = ({
  state,
  children
}: {
  state: TextLoadState
  children: (text: string, truncated: boolean) => ReactNode
}) => {
  const displayText = useMemo(() => state.text.slice(0, TEXT_PREVIEW_MAX_CHARS), [state.text])
  const truncated = state.text.length > TEXT_PREVIEW_MAX_CHARS

  if (state.loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Spin />
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="文件暂时无法预览" />
      </div>
    )
  }

  if (state.text.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="空文件" />
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-auto bg-white">
      {truncated ? (
        <div className="sticky top-0 z-10 border-b border-[#EEEEEC] bg-[#FFF8E5] px-6 py-2 text-xs text-[#7A4D00]">
          文件较大，仅展示前 {TEXT_PREVIEW_MAX_CHARS.toLocaleString()} 个字符。
        </div>
      ) : null}
      {children(displayText, truncated)}
    </div>
  )
}

const PlainTextBody = ({ text }: { text: string }) => (
  <div className="relative min-h-full">
    <LineNumberOverlay
      lineCount={countLines(text)}
      className="w-8"
      testId={workbenchSelectors.lineNumberOverlay}
    />
    <pre
      className="m-0 min-h-full whitespace-pre-wrap break-words px-8 py-6 font-mono text-[13px] leading-6 text-[#37352F]"
      data-testid={workbenchSelectors.plainTextViewer}
    >
      {text}
    </pre>
  </div>
)

export const CustomMarkdownRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const currentDocument = mainState.currentDocument as LoadedFileRenderDocument | undefined
  const state = useDocumentText(currentDocument)

  if (!currentDocument) return null
  if (currentDocument.editable && currentDocument.filePath) {
    return (
      <MarkdownEditor
        key={currentDocument.filePath}
        filePath={currentDocument.filePath}
        allowSelection={currentDocument.metadata?.allowDocumentSelection}
      />
    )
  }

  return (
    <TextPreviewScaffold state={state}>
      {(text, truncated) =>
        truncated ? (
          <PlainTextBody text={text} />
        ) : (
          <div
            id="my-markdown-renderer"
            className="px-8 py-6"
            data-testid={workbenchSelectors.markdownViewer}
          >
            <MarkdownRenderer content={text} />
          </div>
        )
      }
    </TextPreviewScaffold>
  )
}

CustomMarkdownRenderer.fileTypes = ['md', 'markdown', 'text/markdown']
CustomMarkdownRenderer.weight = 2
CustomMarkdownRenderer.fileLoader = arrayBufferFileLoader

export const CustomPlainTextRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const currentDocument = mainState.currentDocument as LoadedFileRenderDocument | undefined
  const state = useDocumentText(currentDocument)

  if (!currentDocument) return null
  if (currentDocument.editable && currentDocument.filePath) {
    return (
      <PlainTextEditor
        key={currentDocument.filePath}
        filePath={currentDocument.filePath}
        allowSelection={currentDocument.metadata?.allowDocumentSelection}
      />
    )
  }

  return (
    <TextPreviewScaffold state={state}>
      {(text) => <PlainTextBody text={text} />}
    </TextPreviewScaffold>
  )
}

CustomPlainTextRenderer.fileTypes = ['txt', 'text/plain']
CustomPlainTextRenderer.weight = 2
CustomPlainTextRenderer.fileLoader = arrayBufferFileLoader

import { useEffect, useState } from 'react'
import type { DocRenderer, DocRendererProps, IDocument } from 'react-doc-viewer'
import { getSlides, loadPresentation } from 'pptx-kit'
import { createPptTextMeasurer, renderPptSvg } from '../../../../shared/pptTextMeasurer'
import PptSlideDeckViewer, { type PptViewerSlide } from './PptSlideDeckViewer'

type PptDocument = Omit<IDocument, 'fileData'> & {
  file?: File | Blob
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
}

const readDocumentBytes = async (document: PptDocument): Promise<Uint8Array> => {
  if (document.file instanceof Blob) return new Uint8Array(await document.file.arrayBuffer())
  if (document.fileData instanceof Blob)
    return new Uint8Array(await document.fileData.arrayBuffer())
  if (document.fileData instanceof ArrayBuffer) return new Uint8Array(document.fileData)
  if (document.fileData instanceof Uint8Array) return document.fileData
  if (document.uri) {
    const response = await fetch(document.uri)
    if (!response.ok) throw new Error(`读取 PPTX 失败（${response.status}）`)
    return new Uint8Array(await response.arrayBuffer())
  }
  throw new Error('缺少 PPTX 预览数据')
}

const svgUrl = (svg: string, urls: string[]): string => {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  urls.push(url)
  return url
}

const CustomPptxRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const document = mainState.currentDocument as PptDocument | undefined
  const [slides, setSlides] = useState<PptViewerSlide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    setSlides([])
    setLoading(true)
    setError(null)
    if (!document) return () => undefined

    const load = async (): Promise<void> => {
      try {
        const bytes = await readDocumentBytes(document)
        const presentation = await loadPresentation(bytes)
        await window.document.fonts.ready
        const context = window.document.createElement('canvas').getContext('2d')
        if (!context) throw new Error('无法初始化 PPT 文字测量')
        const measureText = createPptTextMeasurer(context)
        const sourceSlides = getSlides(presentation)
        const nextSlides: PptViewerSlide[] = []
        for (let index = 0; index < sourceSlides.length; index += 1) {
          if (cancelled) return
          const svg = await renderPptSvg(presentation, sourceSlides[index]!, measureText)
          nextSlides.push({
            id: `slide-${index + 1}`,
            index: index + 1,
            primaryUrl: svgUrl(svg, urls)
          })
          setSlides([...nextSlides])
          if (index === 0) setLoading(false)
          if (index < sourceSlides.length - 1)
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [document])

  return (
    <PptSlideDeckViewer
      slides={slides}
      loading={loading}
      error={error}
      afterTestId="ppt-preview-after"
      thumbnailsTestId="ppt-preview-thumbnails"
      hintTestId="ppt-preview-zoom-hint"
      testId="ppt-preview-viewer"
    />
  )
}

CustomPptxRenderer.fileTypes = [
  'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
CustomPptxRenderer.weight = 1

export default CustomPptxRenderer

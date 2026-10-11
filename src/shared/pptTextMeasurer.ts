import type { TextMeasurer } from 'pptx-kit-preview'
import type { PresentationData, SlideData } from 'pptx-kit'

type TextMeasurementContext = {
  font: string
  measureText: (text: string) => { width: number }
}

const FALLBACK_FAMILIES =
  'Arial, Microsoft YaHei, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif'

/** Use the same font and advances as SVG rendering, including CJK fallback. */
export const createPptTextMeasurer =
  (context: TextMeasurementContext): TextMeasurer =>
  (text, spec) => {
    context.font = `${spec.italic ? 'italic ' : ''}${spec.bold ? 'bold ' : ''}${spec.sizePx}px ${JSON.stringify(spec.family)}, ${FALLBACK_FAMILIES}`
    return {
      widthPx:
        context.measureText(text).width + Math.max(0, [...text].length - 1) * spec.letterSpacingPx
    }
  }

export const renderPptSvg = async (
  presentation: PresentationData,
  slide: SlideData,
  measureText: TextMeasurer,
  includeShapeIds = false
): Promise<string> => {
  // The library has an import-only export; Main is bundled as CommonJS.
  const { renderSlideToSvg } = await import('pptx-kit-preview')
  return renderSlideToSvg(presentation, slide, {
    textLayout: 'svg',
    measureText,
    includeShapeIds
  }).replace(/font-family="([^"]*)"/gu, `font-family="$1, ${FALLBACK_FAMILIES}"`)
}

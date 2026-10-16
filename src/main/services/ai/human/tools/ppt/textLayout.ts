import { createCanvas } from '@napi-rs/canvas'
import { DOMParser } from '@xmldom/xmldom'
import {
  getShapeBoundsResolved,
  type PresentationData,
  type SlideData,
  type SlideShapeData
} from 'pptx-kit'
import { createPptTextMeasurer, renderPptSvg } from '../../../../../../shared/pptTextMeasurer'

const context = createCanvas(1, 1).getContext('2d')
export const measurePptText = createPptTextMeasurer(context)

export const renderPptSlideSvg = (
  presentation: PresentationData,
  slide: SlideData,
  includeShapeIds = false
): Promise<string> => renderPptSvg(presentation, slide, measurePptText, includeShapeIds)

const children = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1)

const numberAttribute = (element: Element, name: string): number =>
  Number(element.getAttribute(name) || 0)

export type PptTableOverflow = { cellIndex: number; text: string }

/** Check the actual lines produced by the preview library against their cells. */
export const findPptTableOverflows = (
  presentation: PresentationData,
  table: SlideShapeData,
  svg: string
): PptTableOverflow[] => {
  const bounds = getShapeBoundsResolved(presentation, table)
  if (!bounds) throw new Error('无法读取表格边界')
  const expected = [bounds.x, bounds.y, bounds.w, bounds.h].map((value) => Number(value) / 9525)
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const group = Array.from(document.getElementsByTagName('g')).find((candidate) => {
    const first = children(candidate)[0]
    return (
      first?.tagName === 'rect' &&
      ['x', 'y', 'width', 'height'].every(
        (name, index) => Math.abs(numberAttribute(first, name) - expected[index]!) < 0.1
      ) &&
      children(candidate).filter((child) => child.tagName === 'rect').length > 1
    )
  })
  if (!group) throw new Error('无法检查表格预览布局')
  const overflows: PptTableOverflow[] = []
  let cell: Element | undefined
  let cellIndex = 0
  for (const child of children(group).slice(1)) {
    if (child.tagName === 'rect') {
      cell = child
      cellIndex += 1
      continue
    }
    if (child.tagName !== 'text' || !cell) continue
    const spans = children(child).filter((span) => span.tagName === 'tspan')
    const advances = spans.map(
      (span) =>
        measurePptText(span.textContent || '', {
          family: span.getAttribute('font-family')?.split(',')[0] || 'sans-serif',
          sizePx: numberAttribute(span, 'font-size'),
          bold:
            span.getAttribute('font-weight') === 'bold' ||
            numberAttribute(span, 'font-weight') >= 600,
          italic: span.getAttribute('font-style') === 'italic',
          letterSpacingPx: numberAttribute(span, 'letter-spacing')
        }).widthPx
    )
    const width = advances.reduce((sum, advance) => sum + advance, 0)
    const anchor = child.getAttribute('text-anchor')
    let x =
      numberAttribute(child, 'x') - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0)
    const y = numberAttribute(child, 'y')
    let outside = false
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index]!
      measurePptText(span.textContent || '', {
        family: span.getAttribute('font-family')?.split(',')[0] || 'sans-serif',
        sizePx: numberAttribute(span, 'font-size'),
        bold:
          span.getAttribute('font-weight') === 'bold' ||
          numberAttribute(span, 'font-weight') >= 600,
        italic: span.getAttribute('font-style') === 'italic',
        letterSpacingPx: numberAttribute(span, 'letter-spacing')
      })
      const metrics = context.measureText(span.textContent || '')
      const right = numberAttribute(cell, 'x') + numberAttribute(cell, 'width')
      const bottom = numberAttribute(cell, 'y') + numberAttribute(cell, 'height')
      outside ||=
        x < numberAttribute(cell, 'x') - 1 ||
        x + advances[index]! > right + 1 ||
        y - metrics.actualBoundingBoxAscent < numberAttribute(cell, 'y') - 1 ||
        y + metrics.actualBoundingBoxDescent > bottom + 1
      x += advances[index]!
    }
    if (outside) overflows.push({ cellIndex, text: child.textContent || '' })
  }
  return overflows
}

export const assertPptTableFits = async (
  presentation: PresentationData,
  slide: SlideData,
  table: SlideShapeData
): Promise<void> => {
  const overflows = findPptTableOverflows(
    presentation,
    table,
    await renderPptSlideSvg(presentation, slide)
  )
  if (overflows.length) {
    throw new Error(
      `表格第 ${overflows[0]!.cellIndex} 个单元格文字超出边界：请增大列宽或行高、减小字号或精简文字`
    )
  }
}

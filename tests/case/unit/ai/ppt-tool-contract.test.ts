import { describe, expect, it } from 'vitest'
import { TOOLSET_DEFINITIONS } from '../../../../src/main/services/ai/human/toolsets'
import { PPT_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/ppt/toolSpecs'
import {
  assertPptElementInCanvas,
  assertPptElementTextFitsBounds,
  assertPptTextFitsBounds,
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptSearchSchema
} from '../../../../src/main/services/ai/human/tools/ppt/toolSchemas'
import { renderLatexToSvg } from '../../../../src/main/services/ai/human/tools/ppt/formula'
import {
  normalizePptColor,
  PPT_CANVAS_HEIGHT,
  PPT_CANVAS_WIDTH
} from '../../../../src/main/services/ai/human/tools/ppt/color'
import { toPptToolFailure } from '../../../../src/main/services/ai/human/tools/ppt/runtime'

const emptySlide = {
  sourcePath: 'deck.pptx',
  type: 'insert_slide' as const,
  elements: [] as const
}

describe('ai unit ppt tool contract', () => {
  it('splits ppt reading and writing into two toolsets and five prefixed tools', () => {
    expect(TOOLSET_DEFINITIONS['ppt-read'].toolNames).toEqual([
      'ppt_read_outline',
      'ppt_read_slides',
      'ppt_search'
    ])
    expect(TOOLSET_DEFINITIONS['ppt-write'].toolNames).toEqual(['ppt_edit'])
    expect(PPT_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'ppt_read_outline',
      'ppt_read_slides',
      'ppt_search',
      'ppt_edit'
    ])
  })

  it('uses docx-like ranges and search scope without maxMatches', () => {
    expect(
      pptOutlineSchema.safeParse({
        sourcePath: 'deck.pptx',
        ranges: [
          { type: 'percent', fromPercent: 0, toPercent: 50 },
          { type: 'slide_index', fromSlideIndex: 3, toSlideIndex: 5 }
        ]
      }).success
    ).toBe(true)
    expect(
      pptReadSlidesSchema.safeParse({
        sourcePath: 'deck.pptx',
        ranges: [{ type: 'slide_ids', slideIds: ['/ppt/slides/slide1.xml'] }]
      }).success
    ).toBe(true)
    expect(
      pptReadSlidesSchema.safeParse({
        sourcePath: 'deck.pptx',
        ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 1 }],
        detail: 'images'
      }).success
    ).toBe(true)
    expect(
      pptReadSlidesSchema.safeParse({
        sourcePath: 'deck.pptx',
        ranges: [{ type: 'slide_index', fromSlideIndex: 1, toSlideIndex: 1 }],
        detail: 'structure'
      }).success
    ).toBe(false)
    expect(
      pptSearchSchema.safeParse({
        sourcePath: 'deck.pptx',
        query: '结论',
        scope: { slideIds: ['/ppt/slides/slide1.xml'] },
        maxMatches: 10
      }).success
    ).toBe(false)
  })

  it('returns failures without warnings', () => {
    expect(toPptToolFailure('deck.pptx', new Error('找不到页面'))).toEqual({
      sourcePath: 'deck.pptx',
      error: '找不到页面'
    })
  })

  it('accepts one operation and rejects html, actions arrays, and the removed single-action contract', () => {
    expect(pptEditSchema.safeParse(emptySlide).success).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'replace_slide',
        slideId: '/ppt/slides/slide1.xml',
        elements: []
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'insert_slide',
        html: '<section data-ppt-slide></section>',
        elements: []
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [{ type: 'insert_slide', elements: [] }]
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'insert_slide',
        position: 'after',
        elements: []
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'move_slide',
        slideId: '/ppt/slides/slide1.xml'
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'duplicate_slide',
        slideId: '/ppt/slides/slide1.xml'
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        type: 'edit_elements',
        slideId: '/ppt/slides/slide1.xml',
        operations: [
          {
            type: 'add_element',
            element: {
              type: 'line',
              from: { x: 100, y: 100 },
              to: { x: 500, y: 100 },
              arrowEnd: true
            }
          }
        ]
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        action: { type: 'insert_slide', html: '<section></section>' }
      }).success
    ).toBe(false)
  })

  it('renders latex fallback as a standalone svg image', () => {
    const svg = renderLatexToSvg(
      String.raw`\begin{aligned}a^2+b^2&=c^2\\x&=\frac{-b}{2a}\end{aligned}`
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('normalizes opaque hex colors before writing native PPT styles', () => {
    expect(normalizePptColor('#abc')).toBe('#AABBCC')
    expect(normalizePptColor('abc')).toBe('#AABBCC')
    expect(normalizePptColor('1FA8A0')).toBe('#1FA8A0')
    expect(normalizePptColor('#1fa8a0')).toBe('#1FA8A0')
    expect(normalizePptColor('ffffff')).toBe('#FFFFFF')
    expect(normalizePptColor(undefined, '#FFFFFF')).toBe('#FFFFFF')
    expect(normalizePptColor('', '#222222')).toBe('#222222')
    expect(() => normalizePptColor('rgb(12, 34, 56)')).toThrow(/#RRGGBB/)
    expect(() => normalizePptColor('rgba(12, 34, 56, 0.5)')).toThrow(/#RRGGBB/)
    expect(() => normalizePptColor('transparent')).toThrow(/#RRGGBB/)
    expect(() => normalizePptColor('rebeccapurple', '#FFFFFF')).toThrow(/#RRGGBB/)
  })

  it('rejects elements that leave the 960×540 canvas', () => {
    expect(() =>
      assertPptElementInCanvas({
        type: 'text',
        text: 'out',
        bounds: { x: 900, y: 0, width: 80, height: 40 }
      })
    ).toThrow(`${PPT_CANVAS_WIDTH}×${PPT_CANVAS_HEIGHT}`)
    expect(() =>
      assertPptElementInCanvas({
        type: 'text',
        text: 'ok',
        bounds: { x: 100, y: 100, width: 400, height: 80 }
      })
    ).not.toThrow()
  })

  it('rejects text whose fontSize exceeds bounds height', () => {
    expect(() =>
      assertPptElementTextFitsBounds({
        type: 'text',
        text: 'big',
        bounds: { x: 40, y: 40, width: 200, height: 24 },
        style: { fontSize: 36 }
      })
    ).toThrow('超过框高')
    expect(() => assertPptTextFitsBounds({ fontSize: 24, boundsHeight: 24 })).not.toThrow()
    expect(() =>
      assertPptElementTextFitsBounds({
        type: 'text',
        text: 'ok',
        bounds: { x: 40, y: 40, width: 200, height: 40 },
        style: { fontSize: 28 }
      })
    ).not.toThrow()
  })
})

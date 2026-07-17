import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  PPT_EDIT_TOOL_SPEC,
  PPT_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/ppt/toolSpecs'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptSearchSchema
} from '../../../../src/main/services/ai/human/tools/ppt/schemas'
import { renderLatexToSvg } from '../../../../src/main/services/ai/human/tools/ppt/formula'

describe('ai unit ppt tool contract', () => {
  it('splits ppt reading and writing into two skills and five prefixed tools', () => {
    expect(SKILL_DEFINITIONS['ppt-read'].toolNames).toEqual([
      'ppt_outline',
      'ppt_read_slides',
      'ppt_search',
      'ppt_render'
    ])
    expect(SKILL_DEFINITIONS['ppt-write'].toolNames).toEqual(['ppt_edit'])
    expect(PPT_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'ppt_outline',
      'ppt_read_slides',
      'ppt_search',
      'ppt_render',
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
      pptSearchSchema.safeParse({
        sourcePath: 'deck.pptx',
        query: '结论',
        scope: { slideIds: ['/ppt/slides/slide1.xml'] },
        maxMatches: 10
      }).success
    ).toBe(false)
  })

  it('accepts one html page, professional element operations and no action arrays', () => {
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        action: { type: 'create_presentation', html: '<section data-ppt-slide></section>' }
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        action: {
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
            },
            { type: 'set_z_order', elementId: '/ppt/slides/slide1.xml#2', placement: 'front' },
            { type: 'duplicate_element', elementId: '/ppt/slides/slide1.xml#3' }
          ]
        }
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [{ type: 'create_presentation', html: '<section></section>' }]
      }).success
    ).toBe(false)
  })

  it('keeps the edit prompt concise and does not teach runtime asset workflow', () => {
    expect(PPT_EDIT_TOOL_SPEC.promptSpec.description).not.toContain('先保存')
    expect(PPT_EDIT_TOOL_SPEC.promptSpec.description).not.toContain('runtime/assets')
    expect(PPT_EDIT_TOOL_SPEC.promptSpec.examples).toHaveLength(1)
  })

  it('renders latex fallback as a standalone svg image', () => {
    const svg = renderLatexToSvg(
      String.raw`\begin{aligned}a^2+b^2&=c^2\\x&=\frac{-b}{2a}\end{aligned}`
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })
})

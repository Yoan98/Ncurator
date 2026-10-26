import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import {
  addBlankSlide,
  addSlideTable,
  createPresentation,
  emu,
  setTableCellTextFormat,
  getTableCells
} from 'pptx-kit'
import { renderSlideToSvg } from 'pptx-kit-preview/node'
import { createPptTextMeasurer } from '../../../../src/shared/pptTextMeasurer'
import {
  assertPptTableFits,
  findPptTableOverflows,
  renderPptSlideSvg
} from '../../../../src/main/services/ai/human/tools/ppt/textLayout'

describe('ai unit PPT text layout', () => {
  it('measures CJK punctuation with actual font advances and explicit letter spacing', () => {
    const context = createCanvas(1, 1).getContext('2d')
    const measure = createPptTextMeasurer(context)
    const text = '王海涛（供应链总监）'
    const result = measure(text, {
      family: 'Carlito',
      sizePx: 24,
      bold: false,
      italic: false,
      letterSpacingPx: 2
    })
    expect(result.widthPx).toBeCloseTo(context.measureText(text).width + ([...text].length - 1) * 2)
    expect(context.font).toContain('24px')
  })

  it('wraps full-width punctuation inside the same table cell instead of covering it', async () => {
    const presentation = createPresentation()
    const slide = addBlankSlide(presentation)
    const table = addSlideTable(slide, {
      x: emu(0),
      y: emu(0),
      w: emu(360 * 12700),
      h: emu(140 * 12700),
      rows: [
        ['负责人', '应对措施'],
        ['王海涛（供应链总监）', '二供认证']
      ]
    })
    const oldSvg = renderSlideToSvg(presentation, slide, { textLayout: 'svg' })
    const svg = await renderPptSlideSvg(presentation, slide)
    expect(findPptTableOverflows(presentation, table, oldSvg).length).toBeGreaterThan(0)
    expect(findPptTableOverflows(presentation, table, svg)).toEqual([])
    expect(svg).toContain('）')
    await expect(assertPptTableFits(presentation, slide, table)).resolves.toBeUndefined()
  })

  it('detects vertical text overflow rather than only checking outer shape bounds', async () => {
    const presentation = createPresentation()
    const slide = addBlankSlide(presentation)
    const table = addSlideTable(slide, {
      x: emu(0),
      y: emu(0),
      w: emu(180 * 12700),
      h: emu(24 * 12700),
      rows: [['中文风险负责人和应对措施需要完整显示']]
    })
    getTableCells(table)
      .flat()
      .forEach((cell) => setTableCellTextFormat(cell, { size: 24 }))
    const overflows = findPptTableOverflows(
      presentation,
      table,
      await renderPptSlideSvg(presentation, slide)
    )
    expect(overflows.length).toBeGreaterThan(0)
    await expect(assertPptTableFits(presentation, slide, table)).rejects.toThrow(
      /Text overflows table cell \d+/
    )
  })
})

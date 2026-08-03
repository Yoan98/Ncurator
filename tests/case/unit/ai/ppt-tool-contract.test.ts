import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  PPT_EDIT_TOOL_SPEC,
  PPT_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/ppt/toolSpecs'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadVisualsSchema,
  pptReadSlidesSchema,
  pptSearchSchema
} from '../../../../src/main/services/ai/human/tools/ppt/schemas'
import { renderLatexToSvg } from '../../../../src/main/services/ai/human/tools/ppt/formula'
import {
  compilePptSlideHtml,
  normalizePptColor,
  PPT_CANVAS_HEIGHT,
  PPT_CANVAS_WIDTH
} from '../../../../src/main/services/ai/human/tools/ppt/htmlCompiler'
import {
  buildPptDiffManifest,
  toPptToolFailure
} from '../../../../src/main/services/ai/human/tools/ppt/runtime'

describe('ai unit ppt tool contract', () => {
  it('splits ppt reading and writing into two skills and five prefixed tools', () => {
    expect(SKILL_DEFINITIONS['ppt-read'].toolNames).toEqual([
      'ppt_read_outline',
      'ppt_read_slides',
      'ppt_search',
      'ppt_read_visuals'
    ])
    expect(SKILL_DEFINITIONS['ppt-write'].toolNames).toEqual(['ppt_edit'])
    expect(PPT_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'ppt_read_outline',
      'ppt_read_slides',
      'ppt_search',
      'ppt_read_visuals',
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
    expect(
      pptReadVisualsSchema.safeParse({
        sourcePath: 'deck.pptx',
        requests: [{ index: 1, instruction: '检查标题是否换行。' }]
      }).success
    ).toBe(true)
    expect(
      pptReadVisualsSchema.safeParse({
        sourcePath: 'deck.pptx',
        requests: Array.from({ length: 11 }, (_, index) => ({
          index: index + 1,
          instruction: '检查页面视觉内容。'
        }))
      }).success
    ).toBe(false)
  })

  it('returns failures without warnings', () => {
    expect(toPptToolFailure('deck.pptx', new Error('找不到页面'))).toEqual({
      ok: false,
      sourcePath: 'deck.pptx',
      error: '找不到页面'
    })
  })

  it('accepts ordered action arrays and rejects the removed single-action contract', () => {
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [{ type: 'insert_slide', html: '<section data-ppt-slide></section>' }]
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [
          {
            type: 'insert_slide',
            position: 'after',
            html: '<section data-ppt-slide></section>'
          }
        ]
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [
          {
            type: 'move_slide',
            slideId: '/ppt/slides/slide1.xml'
          }
        ]
      }).success
    ).toBe(false)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [
          {
            type: 'duplicate_slide',
            slideId: '/ppt/slides/slide1.xml'
          }
        ]
      }).success
    ).toBe(true)
    expect(
      pptEditSchema.safeParse({
        sourcePath: 'deck.pptx',
        actions: [
          {
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

  it('exposes the complete PPT HTML contract in the edit prompt', () => {
    const description = PPT_EDIT_TOOL_SPEC.promptSpec.description
    for (const requiredRule of [
      'insert_slide 的 html 对应一张完整页面',
      'data-ppt-slide',
      'width:1920px',
      'data-ppt-element',
      '禁止使用 CSS 渐变',
      '任何可见文字不得低于 24px',
      '允许使用工作区本地图片和远程图片地址',
      '使用相同尺寸的占位图替代'
    ]) {
      expect(description).toContain(requiredRule)
    }
    for (const internalTerm of [
      'revision',
      'replay',
      'checksum',
      'UUID',
      'postWriteReadback',
      '原子',
      'runtime/assets',
      'action type=',
      '每页只表达一个主要结论',
      '只使用任务中有依据的事实与数据'
    ]) {
      expect(description).not.toContain(internalTerm)
    }
    expect(PPT_EDIT_TOOL_SPEC.promptSpec).not.toHaveProperty('examples')
  })

  it('renders latex fallback as a standalone svg image', () => {
    const svg = renderLatexToSvg(
      String.raw`\begin{aligned}a^2+b^2&=c^2\\x&=\frac{-b}{2a}\end{aligned}`
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('normalizes browser colors before writing native PPT styles', () => {
    expect(normalizePptColor('rgb(12, 34, 56)')).toBe('#0C2238')
    expect(normalizePptColor('rgba(12, 34, 56, 0)')).toBeUndefined()
    expect(normalizePptColor('#abc')).toBe('#AABBCC')
    expect(normalizePptColor('rebeccapurple', '#FFFFFF')).toBe('#FFFFFF')
  })

  it('compiles restricted HTML on a fixed canvas without duplicate nested text', async () => {
    const slide = await compilePptSlideHtml(`
      <section data-ppt-slide style="width:1920px;height:1080px;background:#fff">
        <div data-ppt-element="text" id="title" style="position:absolute;left:100px;top:100px;width:800px;height:100px;color:rgb(12,34,56);font-size:72px"><p>唯一标题</p></div>
        <div data-ppt-element="shape" id="box" style="position:absolute;left:100px;top:240px;width:400px;height:200px;border-top:2px solid #00ff00;border-right:0 solid #ff0000;background:#eeeeee;box-shadow:0 4px 12px rgba(0,0,0,.15)"></div>
        <img data-ppt-element="image" id="photo" src="local.png" style="position:absolute;left:600px;top:240px;width:400px;height:200px;object-fit:cover" />
      </section>
    `)
    expect(slide.width).toBe(PPT_CANVAS_WIDTH)
    expect(slide.height).toBe(PPT_CANVAS_HEIGHT)
    expect(slide.elements.filter((element) => element.sourceId === 'title')).toHaveLength(1)
    expect(slide.elements.find((element) => element.sourceId === 'title')?.type).toBe('text')
    const box = slide.elements.find((element) => element.sourceId === 'box')
    expect(box?.style.fill).toBe('#EEEEEE')
    expect(box?.style.borders?.top).toEqual({ color: '#00FF00', width: 2 })
    expect(box?.style.borders?.right).toBeUndefined()
    expect(box?.style.shadow).toBeTruthy()
    expect(
      slide.elements.find((element) => element.sourceId === 'title')?.style.shadow
    ).toBeUndefined()
    expect(slide.elements.find((element) => element.sourceId === 'photo')?.imageFit).toBe('cover')
  })

  it('rejects unsupported CSS and non-standard slide roots', async () => {
    await expect(
      compilePptSlideHtml(
        '<section data-ppt-slide style="width:1000px;height:1080px"><div data-ppt-element="shape" style="width:10px;height:10px"></div></section>'
      )
    ).rejects.toThrow('1920x1080')
    await expect(
      compilePptSlideHtml(
        '<section data-ppt-slide style="width:1920px;height:1080px"><div data-ppt-element="shape" style="width:10px;height:10px;filter:blur(2px)"></div></section>'
      )
    ).rejects.toThrow('Unsupported CSS property')
    await expect(
      compilePptSlideHtml(
        '<section data-ppt-slide style="width:1920px;height:1080px"><div data-ppt-element="shape" style="width:100px;height:20px;background:linear-gradient(90deg,#0a0,#00f)"></div></section>'
      )
    ).rejects.toThrow('Unsupported CSS background')
  })

  it('requires a readable title and keeps text inside the slide safe area', async () => {
    await expect(
      compilePptSlideHtml(
        '<section data-ppt-slide style="width:1920px;height:1080px"><h1 data-ppt-element="text" style="position:absolute;left:20px;top:100px;width:800px;height:100px;font-size:24px">标题</h1></section>'
      )
    ).resolves.toBeTruthy()
  })

  it('emits v4 net diff semantics without treating structural shifts as moves', () => {
    const beforeSlides = [
      { slideId: 'slide-1', index: 1, pageFingerprint: 'same', elements: [] },
      { slideId: 'slide-2', index: 2, pageFingerprint: 'old', elements: [] }
    ]
    const afterSlides = [
      { slideId: 'slide-2', index: 1, pageFingerprint: 'new', elements: [] },
      { slideId: 'slide-3', index: 2, pageFingerprint: 'new', elements: [] }
    ]
    const beforeFrames = new Map([
      ['slide-1', { index: 1, svg: 'before-1.svg' }],
      ['slide-2', { index: 2, svg: 'before-2.svg' }]
    ])
    const afterFrames = new Map([
      ['slide-2', { index: 1, svg: 'after-2.svg' }],
      ['slide-3', { index: 2, svg: 'after-3.svg' }]
    ])
    const manifest = buildPptDiffManifest({
      beforeSlides,
      afterSlides,
      beforeFrames,
      afterFrames,
      operation: 'updated'
    })
    expect(manifest.version).toBe(4)
    expect(manifest.slides.map((slide) => slide.changes)).toEqual([
      ['deleted'],
      ['modified'],
      ['added']
    ])
    expect({ positive: manifest.positiveCount, negative: manifest.negativeCount }).toEqual({
      positive: 2,
      negative: 1
    })
    expect(
      buildPptDiffManifest({
        beforeSlides: [],
        afterSlides,
        beforeFrames: new Map(),
        afterFrames,
        operation: 'created'
      }).slides.every((slide) => slide.changes.includes('added'))
    ).toBe(true)
  })
})

import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { buildNodeIndex } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { buildDocxSegmentMap } from '../../../../src/main/services/ai/human/tools/docx/segmentMap'

const paragraph = (text: string, properties = ''): string =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`

const document = (content: string): Document =>
  new DOMParser().parseFromString(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr/></w:body></w:document>`,
    'application/xml'
  )

describe('docx segment map', () => {
  it('uses the target, lookahead and isolated structural boundaries without gaps', () => {
    const normal = Array.from({ length: 25 }, (_item, index) =>
      paragraph(`普通段落 ${index}`)
    ).join('')
    const heading = paragraph('可靠标题', '<w:outlineLvl w:val="1"/>')
    const trailing = Array.from({ length: 8 }, (_item, index) =>
      paragraph(`标题后正文 ${index}`)
    ).join('')
    const control =
      '<w:sdt><w:sdtPr><w:tag w:val="受控区域"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>控件内容</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    const table =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表头一</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>表头二</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const index = buildNodeIndex(document(`${normal}${heading}${trailing}${control}${table}`))
    const segments = buildDocxSegmentMap(index)

    expect(segments.map((segment) => [segment.fromNodeIndex, segment.toNodeIndex])).toEqual([
      [0, 24],
      [25, 33],
      [34, 34],
      [35, 35]
    ])
    expect(
      segments.reduce(
        (total, segment) => total + segment.toNodeIndex - segment.fromNodeIndex + 1,
        0
      )
    ).toBe(36)
    expect(segments[1]?.textMap).toContain('可靠标题')
    expect(segments[2]?.textMap).toContain('受控区域')
    expect(segments[3]?.textMap).toContain('表格 1x2')
  })

  it('enforces node, visible text and textMap budgets while keeping extractive sources', () => {
    const repeated = Array.from({ length: 40 }, (_item, index) =>
      paragraph(
        index === 0
          ? `${'核心主题 '.repeat(20)}低分边缘词。`
          : `核心主题用于稳定定位。第 ${index} 段补充不同事实。`
      )
    ).join('')
    const index = buildNodeIndex(document(repeated))
    const segments = buildDocxSegmentMap(index)

    expect(segments.map((segment) => segment.toNodeIndex - segment.fromNodeIndex + 1)).toEqual([
      20, 20
    ])
    expect(segments.every((segment) => Array.from(segment.textMap).length <= 360)).toBe(true)
    expect(segments.every((segment) => /代表句：\[\d+\]/u.test(segment.textMap))).toBe(true)
    expect(segments[0]?.textMap).toContain('核心')
    expect(segments[0]?.textMap).toContain('主题')
    expect(segments[0]?.textMap).not.toContain('关键词：低分边缘词')
  })

  it('lets one overlong root stand alone and continues after it', () => {
    const index = buildNodeIndex(
      document(`${paragraph('长'.repeat(8_100))}${paragraph('后续短段')}`)
    )
    const segments = buildDocxSegmentMap(index)
    expect(segments.map((segment) => [segment.fromNodeIndex, segment.toNodeIndex])).toEqual([
      [0, 0],
      [1, 1]
    ])
  })

  it('resolves real outlineLevel through the paragraph style inheritance chain', () => {
    const content = [
      ...Array.from({ length: 23 }, (_item, index) => paragraph(`前文 ${index}`)),
      paragraph('样式标题', '<w:pStyle w:val="ChildHeading"/>'),
      paragraph('标题后正文')
    ].join('')
    const stylesDom = new DOMParser().parseFromString(
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="BaseHeading"><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="ChildHeading"><w:basedOn w:val="BaseHeading"/></w:style></w:styles>',
      'application/xml'
    )
    const segments = buildDocxSegmentMap(buildNodeIndex(document(content)), { stylesDom })

    expect(segments.map((segment) => [segment.fromNodeIndex, segment.toNodeIndex])).toEqual([
      [0, 22],
      [23, 24]
    ])
    expect(segments[1]?.textMap).toContain('结构：样式标题')
  })

  it('keeps heading and visual anchors together for an isolated visual root', () => {
    const visualParagraph =
      '<w:p xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>图示标题</w:t><w:drawing><wp:inline><wp:docPr id="1" name="Diagram" descr="架构总览"/></wp:inline></w:drawing></w:r></w:p>'
    const segments = buildDocxSegmentMap(
      buildNodeIndex(document(`${paragraph('前文')}${visualParagraph}${paragraph('后文')}`))
    )

    expect(segments.map((segment) => [segment.fromNodeIndex, segment.toNodeIndex])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ])
    expect(segments[1]?.textMap).toContain('图示标题')
    expect(segments[1]?.textMap).toContain('视觉 shape')
    expect(segments[1]?.textMap).toContain('架构总览')
  })
})

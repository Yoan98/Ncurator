import { describe, expect, it } from 'vitest'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { buildDocxNetReview } from '../../../../src/main/services/ai/human/tools/docx/review/netReview'
import {
  paragraphXml as p,
  reviewBuffer,
  reviewRuns,
  storyText,
  projectReview,
  elementChildren
} from '../../../harness/backend/docxReviewAssertions'
import { W } from '../../../../src/main/services/ai/human/tools/docx/review/documentModel'
const compare = async (
  before: string,
  after: string,
  oldExtras: Record<string, string | Buffer> = {},
  newExtras = oldExtras
) => {
  const old = await loadDocxBundle(await reviewBuffer(before, oldExtras)),
    next = await loadDocxBundle(await reviewBuffer(after, newExtras))
  const result = await buildDocxNetReview(old, next)
  return { ...result, bundle: next, document: next.documentDom }
}
const relationship = (id: string, target: string, type = 'hyperlink', mode = 'External') =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" ${mode ? `TargetMode="${mode}"` : ''}/></Relationships>`
const cell = (text: string) => `<w:tc><w:tcPr/>${p(text)}</w:tc>`
const row = (texts: string[]) => `<w:tr>${texts.map(cell).join('')}</w:tr>`
const table = (rows: string[][]) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>${rows.map(row).join('')}</w:tbl>`
describe('DOCX structural and relationship fidelity', () => {
  it('diffs across styled runs and hyperlinks without severing the destination', async () => {
    const before =
      '<w:p><w:r><w:t>前</w:t></w:r><w:hyperlink r:id="old"><w:r><w:rPr><w:b/></w:rPr><w:t>126</w:t></w:r></w:hyperlink><w:r><w:t>后</w:t></w:r></w:p>'
    const after = before.replace('old', 'new').replace('126', '128')
    const result = await compare(
      before,
      after,
      { 'word/_rels/document.xml.rels': relationship('old', 'https://example.com/a') },
      { 'word/_rels/document.xml.rels': relationship('new', 'https://example.com/a') }
    )
    expect(storyText(result.document, false)).toEqual(['前126后'])
    expect(storyText(result.document, true)).toEqual(['前128后'])
    const relXml = await result.bundle.zip.file('word/_rels/document.xml.rels')!.async('text')
    for (const link of Array.from(result.document.getElementsByTagNameNS(W, 'hyperlink')))
      expect(relXml).toContain(link.getAttribute('r:id'))
    expect(
      reviewRuns(result.document)
        .filter((r) => r.kind === 'deleted')
        .map((r) => r.text)
    ).toEqual(['6'])
  })
  it('ignores relationship ids and hyperlink run splits with identical meaning', async () => {
    const result = await compare(
      '<w:p><w:hyperlink r:id="old"><w:r><w:t>链接</w:t></w:r></w:hyperlink></w:p>',
      '<w:p><w:hyperlink r:id="new"><w:r><w:t>链</w:t></w:r><w:r><w:t>接</w:t></w:r></w:hyperlink></w:p>',
      { 'word/_rels/document.xml.rels': relationship('old', 'https://example.com/a') },
      { 'word/_rels/document.xml.rels': relationship('new', 'https://example.com/a') }
    )
    expect(result.stats.changeCount).toBe(0)
  })
  it('keeps both old and new binaries when the same resource filename changes', async () => {
    const drawing =
      '<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="img"/></w:drawing></w:r></w:p>'
    const extra = {
      'word/_rels/document.xml.rels': relationship('img', 'media/image.png', 'image', ''),
      'word/media/image.png': Buffer.from('old-binary')
    }
    const result = await compare(drawing, drawing, extra, {
      ...extra,
      'word/media/image.png': Buffer.from('new-binary')
    })
    expect(result.stats).toEqual({ changeCount: 1, insertCount: 1, deleteCount: 1 })
    const names = Object.keys(result.bundle.zip.files).filter((n) => n.endsWith('.png'))
    const binaries = await Promise.all(
      names.map(async (n) => (await result.bundle.zip.file(n)!.async('nodebuffer')).toString())
    )
    expect(binaries).toContain('old-binary')
    expect(binaries).toContain('new-binary')
    expect(result.document.getElementsByTagName('w:drawing').length).toBe(2)
  })
  it('does not mistake image removal for unchanged empty text', async () => {
    const before =
      '<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="img"/></w:drawing></w:r></w:p>'
    const result = await compare(before, '<w:p/>', {
      'word/_rels/document.xml.rels': relationship('img', 'media/img.png', 'image', ''),
      'word/media/img.png': Buffer.from('pixel')
    })
    expect(result.stats.changeCount).toBe(1)
    const body = result.document.getElementsByTagNameNS(W, 'body')[0]!
    expect(projectReview(body, true)!.getElementsByTagName('w:drawing').length).toBe(0)
    expect(projectReview(body, false)!.getElementsByTagName('w:drawing').length).toBe(1)
  })
  it('counts one changed cell and keeps its character diff within the cell', async () => {
    const result = await compare(
      table([
        ['A', '126'],
        ['B', 'keep']
      ]),
      table([
        ['A', '128'],
        ['B', 'keep']
      ])
    )
    expect(result.stats).toEqual({ changeCount: 1, insertCount: 1, deleteCount: 1 })
    expect(storyText(result.document, true)).toEqual(['A128Bkeep'])
    expect(storyText(result.document, false)).toEqual(['A126Bkeep'])
  })
  it.each(['row', 'column'])(
    'preserves original/final table topology for inserted %s',
    async (kind) => {
      const old = [
          ['A', 'B'],
          ['C', 'D']
        ],
        next =
          kind === 'row'
            ? [
                ['A', 'B'],
                ['X', 'Y'],
                ['C', 'D']
              ]
            : [
                ['A', 'X', 'B'],
                ['C', 'Y', 'D']
              ]
      const result = await compare(table(old), table(next)),
        tbl = result.document.getElementsByTagNameNS(W, 'tbl')[0]!
      const rows = (accept: boolean) =>
        elementChildren(projectReview(tbl, accept)!)
          .filter((e) => e.localName === 'tr')
          .map((r) =>
            elementChildren(r)
              .filter((e) => e.localName === 'tc')
              .map((c) => c.getElementsByTagNameNS(W, 't')[0]?.textContent)
          )
      expect(rows(false)).toEqual(old)
      expect(rows(true)).toEqual(next)
    }
  )
  it('localizes named-style changes and preserves original style for deleted text', async () => {
    const style = (color: string) =>
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="X"><w:rPr><w:color w:val="${color}"/></w:rPr></w:style></w:styles>`
    const result = await compare(
      p('旧', '', '<w:pStyle w:val="X"/>') + p('无关'),
      p('新', '', '<w:pStyle w:val="X"/>') + p('无关'),
      { 'word/styles.xml': style('112233') },
      { 'word/styles.xml': style('445566') }
    )
    const runs = reviewRuns(result.document)
    expect(runs.find((r) => r.kind === 'deleted')!.xml).toContain('B42318')
    expect(runs.find((r) => r.text === '无关')!.kind).toBe('')
    const styles = await result.bundle.zip.file('word/styles.xml')!.async('text')
    expect(styles).toContain('112233')
    expect(styles).toContain('445566')
  })
  it('marks the affected section without marking another section', async () => {
    const section = (width: string) => `<w:sectPr><w:pgSz w:w="${width}" w:h="16000"/></w:sectPr>`
    const result = await compare(
      p('第一节', '', section('12000')) + p('第二节') + section('12000'),
      p('第一节', '', section('16000')) + p('第二节') + section('12000')
    )
    expect(
      reviewRuns(result.document)
        .filter((r) => r.kind)
        .map((r) => r.text)
    ).toEqual(['第一节'])
    expect(result.stats.insertCount).toBe(0)
  })
  it('localizes a theme font change to characters that actually use that font', async () => {
    const theme = (latin: string) =>
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="Theme"><a:minorFont><a:latin typeface="${latin}"/><a:ea typeface="宋体"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`
    const text = p(
      '中A',
      '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/>'
    )
    const result = await compare(
      text,
      text,
      { 'word/theme/theme1.xml': theme('Arial') },
      { 'word/theme/theme1.xml': theme('Calibri') }
    )
    expect(
      reviewRuns(result.document)
        .filter((r) => r.kind)
        .map((r) => r.text)
    ).toEqual(['A'])
    expect(result.stats).toEqual({ changeCount: 1, insertCount: 0, deleteCount: 0 })
  })
  it('keeps an independent unused style change even alongside changed text', async () => {
    const style = (name: string) =>
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Unused"><w:name w:val="${name}"/></w:style></w:styles>`
    const result = await compare(
      p('old'),
      p('new'),
      { 'word/styles.xml': style('Old') },
      { 'word/styles.xml': style('New') }
    )
    expect(result.stats).toEqual({ changeCount: 2, insertCount: 1, deleteCount: 1 })
  })
  it('retains existing user revisions and user strike/shading when unchanged', async () => {
    const original = `<w:ins w:id="42" w:author="User">${p('用户原有修订', '<w:strike/><w:shd w:fill="EEAA00"/>')}</w:ins>`
    const result = await compare(original + p('old'), original + p('new'))
    const revision = result.document.getElementsByTagNameNS(W, 'ins')[0]!
    expect(revision.getAttribute('w:id')).toBe('42')
    expect(revision.toString()).toContain('EEAA00')
    expect(revision.toString()).not.toContain('ncr:change')
  })
  it('registers original definitions that are absent from the final package', async () => {
    const extras = {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Old"><w:rPr><w:b/></w:rPr></w:style></w:styles>`,
      'word/numbering.xml': `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
    }
    const result = await compare(
      p('原文', '', '<w:pStyle w:val="Old"/><w:numPr><w:numId w:val="1"/></w:numPr>'),
      '',
      extras,
      {}
    )
    expect(storyText(result.document, false)).toEqual(['原文'])
    const rels = await result.bundle.zip.file('word/_rels/document.xml.rels')!.async('text')
    const types = await result.bundle.zip.file('[Content_Types].xml')!.async('text')
    for (const kind of ['styles', 'numbering']) {
      expect(result.bundle.zip.file(`word/${kind}.xml`)).not.toBeNull()
      expect(rels).toContain(`Target="${kind}.xml"`)
      expect(types).toContain(`PartName="/word/${kind}.xml"`)
    }
  })
  it('keeps the original inherited font size on deleted characters inside the final paragraph', async () => {
    const style = (size: number, bold = '') =>
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="X"><w:rPr><w:sz w:val="${size}"/>${bold}</w:rPr></w:style></w:styles>`
    const result = await compare(
      p('旧', '', '<w:pStyle w:val="X"/>'),
      p('新', '', '<w:pStyle w:val="X"/>'),
      { 'word/styles.xml': style(22) },
      { 'word/styles.xml': style(48, '<w:b/>') }
    )
    const deleted = reviewRuns(result.document).find((r) => r.kind === 'deleted')!
    expect(deleted.xml).toContain('w:sz w:val="22"')
    expect(deleted.xml).toContain('w:b w:val="0"')
    expect(deleted.xml).not.toContain('w:sz w:val="48"')
  })
  it('merges individual font attributes and resolves theme tint without false changes', async () => {
    const extra = {
      'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="宋体"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
      'word/theme/theme1.xml':
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="000000"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'
    }
    const result = await compare(
      p('中A', '<w:rFonts w:ascii="Arial"/><w:color w:themeColor="accent1" w:themeTint="80"/>'),
      p('中A', '<w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:color w:val="7F7F7F"/>'),
      extra
    )
    expect(result.stats.changeCount).toBe(0)
    const changed = await compare(
      p('A', '<w:color w:themeColor="accent1"/>'),
      p('B', '<w:color w:themeColor="accent1"/>'),
      extra
    )
    expect(
      reviewRuns(changed.document)
        .filter((r) => r.kind)
        .every((r) => !r.xml.includes('themeColor'))
    ).toBe(true)
  })
})

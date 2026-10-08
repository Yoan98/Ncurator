import { describe, expect, it } from 'vitest'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { buildDocxNetReview } from '../../../../src/main/services/ai/human/tools/docx/review/netReview'
import { graphemes } from '../../../../src/main/services/ai/human/tools/docx/review/inlineDiff'
import {
  paragraphXml as p,
  reviewBuffer,
  reviewRuns,
  storyText
} from '../../../harness/backend/docxReviewAssertions'

const compare = async (
  before: string,
  after: string,
  oldExtras: Record<string, string | Buffer> = {},
  newExtras = oldExtras
) => {
  const source = await loadDocxBundle(await reviewBuffer(before, oldExtras))
  const working = await loadDocxBundle(await reviewBuffer(after, newExtras))
  const result = await buildDocxNetReview(source, working)
  return { ...result, document: working.documentDom, zip: working.zip }
}
describe('DOCX first/final net review', () => {
  it.each([
    [
      ['title', 'date', 'conclusion', 'section', 'risk', 'tail'],
      ['title', 'date', 'risk', 'conclusion', 'section', 'tail']
    ],
    [
      ['title', 'date', 'conclusion', 'section', 'risk', 'tail'],
      ['title', 'date', 'section', 'risk', 'conclusion', 'tail']
    ],
    [
      ['A', 'B', 'C'],
      ['B', 'A', 'C']
    ],
    [
      ['A', 'B', 'C', 'D'],
      ['C', 'D', 'A', 'B']
    ],
    [
      ['A', 'same', 'B', 'same', 'C'],
      ['A', 'same', 'same', 'B', 'C']
    ],
    [
      ['风险旧稿', '结论', '尾段'],
      ['结论', '尾段', '风险新稿']
    ],
    [
      ['A', 'B'],
      ['B', 'new', 'A']
    ],
    [
      ['A', 'A', 'B'],
      ['A', 'B', 'B']
    ]
  ])('restores both orders for %j → %j', async (before, after) => {
    const result = await compare(before.map((t) => p(t)).join(''), after.map((t) => p(t)).join(''))
    expect(storyText(result.document, false)).toEqual(before)
    expect(storyText(result.document, true)).toEqual(after)
  })
  it.each([
    ['尾款126万元', '尾款128万元'],
    ['甲乙丙丁戊', '甲新丙好戊'],
    ['a b\tZ', 'a  b\tQ'],
    ['👩🏽‍💻é🙂', '👩🏽‍💻é🙃'],
    ['abc', ''],
    ['', 'new'],
    ['123abc！？', '123ABC？'],
    ['重复重复', '重复变化重复']
  ])('character diff preserves %j and %j', async (before, after) => {
    const result = await compare(p(before), p(after))
    expect(storyText(result.document, false)).toEqual([before])
    expect(storyText(result.document, true)).toEqual([after])
    expect(result.stats).toEqual({ changeCount: 1, insertCount: 1, deleteCount: 1 })
    expect(
      reviewRuns(result.document)
        .filter((r) => r.kind === 'deleted')
        .every((r) => r.xml.includes('strike'))
    ).toBe(true)
  })
  it('splits by grapheme, including a cluster crossing run boundaries', async () => {
    expect(graphemes('👩🏽‍💻é🇨🇳')).toEqual(['👩🏽‍💻', 'é', '🇨🇳'])
    const result = await compare(
      '<w:p><w:r><w:t>e</w:t></w:r><w:r><w:t>́旧</w:t></w:r></w:p>',
      p('é新')
    )
    expect(
      reviewRuns(result.document)
        .filter((r) => r.kind === 'deleted')
        .map((r) => r.text)
        .join('')
    ).toBe('旧')
    expect(storyText(result.document, true)).toEqual(['é新'])
  })
  it('ignores arbitrary run splits and node identities', async () => {
    const result = await compare(
      p('一致'),
      '<w:p w:rsidR="ABCD"><w:r><w:t>一</w:t></w:r><w:r><w:t>致</w:t></w:r></w:p>'
    )
    expect(result.stats.changeCount).toBe(0)
    expect(reviewRuns(result.document).every((r) => !r.kind)).toBe(true)
  })
  it('marks only characters whose format changes, preserving their foreground/background', async () => {
    const result = await compare(
      '<w:p><w:r><w:t>前</w:t></w:r><w:r><w:rPr><w:color w:val="223344"/><w:shd w:fill="FFFF00"/></w:rPr><w:t>中</w:t></w:r><w:r><w:t>后</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>前</w:t></w:r><w:r><w:rPr><w:color w:val="223344"/><w:shd w:fill="00FFFF"/><w:b/></w:rPr><w:t>中</w:t></w:r><w:r><w:t>后</w:t></w:r></w:p>'
    )
    const runs = reviewRuns(result.document)
    expect(runs.filter((r) => r.kind).map((r) => r.text)).toEqual(['中'])
    expect(runs[1]!.xml).toContain('223344')
    expect(runs[1]!.xml).toContain('00FFFF')
    expect(runs[1]!.xml).toContain('w:bdr')
    expect(result.stats).toEqual({ changeCount: 1, insertCount: 0, deleteCount: 0 })
    expect(storyText(result.document)).toEqual(['前中后'])
  })
  it('uses border when background has been removed', async () => {
    const result = await compare(p('背景', '<w:shd w:fill="FFFF00"/>'), p('背景'))
    expect(
      reviewRuns(result.document).every((r) => r.xml.includes('w:bdr') && !r.xml.includes('E9F7EF'))
    ).toBe(true)
  })
  it('does not split complex fields into visible characters', async () => {
    const field = (result: string) =>
      `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DATE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    const result = await compare(field('2025'), field('2026'))
    expect(result.document.getElementsByTagName('w:instrText').length).toBe(2)
    expect(storyText(result.document, false)).toEqual(['2025'])
    expect(storyText(result.document, true)).toEqual(['2026'])
  })
  it('bounds output/time for a long, fragmented repeated paragraph', async () => {
    const text = '重复测试'.repeat(3000)
    const fragmented = `<w:p>${Array.from(text)
      .map((char) => `<w:r><w:t>${char}</w:t></w:r>`)
      .join('')}</w:p>`
    const start = Date.now(),
      result = await compare(fragmented, p(text.slice(0, -1) + '新'))
    expect(Date.now() - start).toBeLessThan(15000)
    expect(storyText(result.document, true)).toEqual([text.slice(0, -1) + '新'])
    expect(reviewRuns(result.document).length).toBeLessThan(10)
  }, 20000)
  it('keeps unchanged characters when a large edit exceeds the fast alignment limit', async () => {
    const before = '前缀' + '甲乙'.repeat(2000) + '后缀'
    const after = '前缀' + '丙乙'.repeat(2000) + '后缀'
    const start = Date.now(),
      result = await compare(p(before), p(after))
    const runs = reviewRuns(result.document)
    expect(
      runs
        .filter((r) => r.kind === 'deleted')
        .map((r) => r.text)
        .join('')
    ).toBe('甲'.repeat(2000))
    expect(
      runs
        .filter((r) => r.kind === 'inserted')
        .map((r) => r.text)
        .join('')
    ).toBe('丙'.repeat(2000))
    expect(
      runs
        .filter((r) => !r.kind)
        .map((r) => r.text)
        .join('')
    ).toBe('前缀' + '乙'.repeat(2000) + '后缀')
    expect(storyText(result.document, false)).toEqual([before])
    expect(storyText(result.document, true)).toEqual([after])
    expect(Date.now() - start).toBeLessThan(15000)
    expect(runs.length).toBeLessThanOrEqual(before.length * 2)
  }, 20000)
})

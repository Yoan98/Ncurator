import { describe, expect, it } from 'vitest'
import {
  buildNcuratorRefMarkdown,
  encodeNcuratorRefValue,
  normalizeNcuratorRefMarkdownLinks,
  parseNcuratorRefHref,
  repairInlineCodeWrappedNcuratorLinks,
  type NcuratorRefResourceType
} from '../../../../src/shared/ncuratorRef'

/**
 * Extract the link destination from a `[label](dest)` string.
 * Safe because the codec percent-encodes every literal `(`/`)` inside values,
 * so the only bare parens are the ones delimiting the destination.
 */
const extractHref = (markdown: string): string =>
  markdown.slice(markdown.indexOf('](') + 2, markdown.lastIndexOf(')'))

/**
 * The exact CommonMark rule that corrupted Windows paths: inside a link
 * destination, a backslash before ASCII punctuation escapes (drops) the
 * backslash. If the encoder is correct there are no bare backslashes left, so
 * this must be a no-op on the destination.
 */
const commonmarkUnescapeDestination = (dest: string): string =>
  dest.replace(/\\(.)/g, (match, char: string) => (/[!-/:-@[-`{-~]/.test(char) ? char : match))

describe('ai unit ncurator ref codec', () => {
  const cases: Array<{
    name: string
    label: string
    path: string
    resourceType: NcuratorRefResourceType
  }> = [
    {
      name: 'windows path with dot-prefixed hidden dir (the reported bug)',
      label: '交互式探究学习案例：产业转移.docx',
      path: 'D:\\1-work-space\\test\\workspace\\.ncurator\\runtime\\assets\\d6fd02d9-b641-4a73-b047-0f286e2e5072\\交互式探究学习案例：产业转移.docx',
      resourceType: 'file'
    },
    {
      name: 'windows path with balanced parens and a space',
      label: '报告 (v2).docx',
      path: 'D:\\a\\b (v2)\\报告.docx',
      resourceType: 'file'
    },
    {
      name: 'windows path ending in a lone close paren',
      label: 'end).docx',
      path: 'D:\\weird\\end).docx',
      resourceType: 'file'
    },
    {
      name: 'mac path with ampersand and space',
      label: 'report & draft.docx',
      path: '/Users/x/notes/report & draft.docx',
      resourceType: 'file'
    },
    {
      name: 'path with plus, equals and hash',
      label: 'e#f.docx',
      path: 'C:\\a+b\\c=d\\e#f.docx',
      resourceType: 'file'
    },
    {
      name: 'unicode mac path with slashes preserved',
      label: '客户周会纪要.docx',
      path: '/tmp/工作/客户周会纪要.docx',
      resourceType: 'file'
    },
    {
      name: 'web url with query parameters',
      label: '审批规则',
      path: 'https://example.com/a?x=1&name=测试',
      resourceType: 'web'
    }
  ]

  it.each(cases)('round-trips build -> parse for $name', ({ label, path, resourceType }) => {
    const markdown = buildNcuratorRefMarkdown({
      label,
      path,
      resourceType,
      accessStatus: 'accessible',
      kind: 'reference'
    })
    const href = extractHref(markdown)

    // CommonMark must not alter the destination we produced.
    expect(commonmarkUnescapeDestination(href)).toBe(href)

    const parsed = parseNcuratorRefHref(href)
    expect(parsed).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType,
      accessStatus: 'accessible',
      label,
      path
    })
  })

  it('encodes every character CommonMark or URLSearchParams would break on', () => {
    const encoded = encodeNcuratorRefValue('D:\\a (b)\\c&d=e+f#g<h>i j.docx')
    // none of these survive as literals inside a link destination / query value
    expect(encoded).not.toMatch(/[\\()<>&=+#\s]/)
    // decodes back cleanly
    expect(decodeURIComponent(encoded)).toBe('D:\\a (b)\\c&d=e+f#g<h>i j.docx')
  })

  it('keeps CJK text and path separators human-readable', () => {
    const encoded = encodeNcuratorRefValue('/Users/test/工作/客户周会纪要.docx')
    expect(encoded).toBe('/Users/test/工作/客户周会纪要.docx')
    expect(encoded).not.toContain('%')
  })

  it('marks malformed ncurator links invalid when kind is missing', () => {
    const href = 'ncurator://ref?resourceType=file&path=%2Ftmp%2Fa.docx'
    expect(parseNcuratorRefHref(href)).toEqual({ type: 'invalid', href, reason: 'invalid_kind' })
  })

  it('rejects links when resourceType is missing', () => {
    const href =
      'ncurator://ref?kind=reference&accessStatus=accessible&label=报告.docx&path=/tmp/workspace/report.docx'
    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'invalid',
      href,
      reason: 'invalid_resource_type'
    })
  })

  it('treats historical evidence without accessStatus as unavailable', () => {
    const href =
      'ncurator://ref?kind=reference&resourceType=file&label=历史报告&path=/tmp/report.docx'
    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      accessStatus: 'unavailable',
      label: '历史报告',
      path: '/tmp/report.docx'
    })
  })

  it('treats unknown evidence accessStatus as unavailable', () => {
    const href =
      'ncurator://ref?kind=reference&resourceType=web&accessStatus=unknown&label=旧网页&path=https://example.com/old'
    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'web',
      accessStatus: 'unavailable',
      label: '旧网页',
      path: 'https://example.com/old'
    })
  })

  it('parses normal resource links without accessStatus', () => {
    const markdown = buildNcuratorRefMarkdown({
      kind: 'normal',
      resourceType: 'web',
      label: 'OpenAI',
      path: 'https://openai.com'
    })
    const href = extractHref(markdown)

    expect(href).not.toContain('accessStatus')
    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'normal',
      resourceType: 'web',
      label: 'OpenAI',
      path: 'https://openai.com'
    })
  })

  it('passes through normal href values', () => {
    expect(parseNcuratorRefHref('https://openai.com')).toEqual({
      type: 'normal',
      href: 'https://openai.com'
    })
  })

  it('parses raw windows paths emitted without canonical encoding', () => {
    const rawPath =
      'D:\\1-work-space\\test\\workspace\\.ncurator\\runtime\\assets\\d6fd02d9-b641-4a73-b047-0f286e2e5072\\交互式探究学习案例：产业转移.docx'
    const href = `ncurator://ref?kind=reference&resourceType=file&accessStatus=accessible&label=交互式探究学习案例：产业转移.docx&path=${rawPath}`

    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      accessStatus: 'accessible',
      label: '交互式探究学习案例：产业转移.docx',
      path: rawPath
    })
  })

  it('normalizes raw markdown links before CommonMark can consume path backslashes', () => {
    const rawPath =
      'D:\\1-work-space\\test\\workspace\\.ncurator\\runtime\\assets\\d6fd02d9-b641-4a73-b047-0f286e2e5072\\交互式探究学习案例：产业转移.docx'
    const markdown = `[交互式探究学习案例：产业转移.docx](ncurator://ref?kind=reference&resourceType=file&accessStatus=accessible&label=交互式探究学习案例：产业转移.docx&path=${rawPath})`
    const normalized = normalizeNcuratorRefMarkdownLinks(markdown)
    const href = extractHref(normalized)

    expect(href).toContain('%5C.ncurator%5Cruntime%5Cassets')
    expect(commonmarkUnescapeDestination(href)).toBe(href)
    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      accessStatus: 'accessible',
      label: '交互式探究学习案例：产业转移.docx',
      path: rawPath
    })
  })

  it('unwraps a valid ncurator markdown link from inline code', () => {
    const link = buildNcuratorRefMarkdown({
      kind: 'reference',
      resourceType: 'file',
      accessStatus: 'accessible',
      label: '报告.xlsx',
      path: '/tmp/报告.xlsx'
    })

    expect(repairInlineCodeWrappedNcuratorLinks(`文件：\`${link}\``)).toBe(`文件：${link}`)
  })

  it('keeps normal inline code and invalid ncurator links unchanged', () => {
    const normalCode = '`sourcePath`'
    const invalidLink = '`[报告](ncurator://ref?kind=reference&resourceType=file)`'

    expect(repairInlineCodeWrappedNcuratorLinks(normalCode)).toBe(normalCode)
    expect(repairInlineCodeWrappedNcuratorLinks(invalidLink)).toBe(invalidLink)
  })

  it('parses browser-normalized windows paths without a leading slash', () => {
    const href =
      'ncurator://ref?kind=reference&resourceType=file&accessStatus=unavailable&label=报告.docx&path=/D:/work/a%20(b)/报告.docx'

    expect(parseNcuratorRefHref(href)).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      accessStatus: 'unavailable',
      label: '报告.docx',
      path: 'D:/work/a (b)/报告.docx'
    })
  })
})

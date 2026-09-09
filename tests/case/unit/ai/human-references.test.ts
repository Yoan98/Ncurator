import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  classifyMarkdownHref,
  extractMarkdownLinkHrefs,
  findMarkdownLinkAccess,
  markdownLinkAccessKey
} from '../../../../src/shared/markdownLink'
import { resolveReferencePathsAccess } from '../../../../src/main/services/ai/human/shared/evidenceReferenceAccess'
import { resolveDeliveryLinkAccess } from '../../../../src/main/services/ai/human/shared/referenceAccessMarkdown'
import { resolveMarkdownLinkForRender } from '../../../../src/renderer/src/components/markdownReference'

describe('ai unit markdown link access', () => {
  it('classifies absolute file paths and https urls', () => {
    expect(classifyMarkdownHref('/tmp/a.docx')).toEqual({
      type: 'file',
      href: '/tmp/a.docx',
      path: '/tmp/a.docx'
    })
    expect(classifyMarkdownHref('https://example.com/a?x=1')).toEqual({
      type: 'web',
      href: 'https://example.com/a?x=1',
      url: 'https://example.com/a?x=1'
    })
    expect(classifyMarkdownHref('D:\\work\\a.docx').type).toBe('file')
  })

  it('decodes percent-encoded file hrefs for classification and sidecar keys', () => {
    const encoded =
      '/Users/test/work-space/workspace-test/workspace/PPT%E7%BE%8E%E5%8C%96%E6%96%B9%E6%A1%88_%E8%AE%A8%E8%AE%BA%E7%A8%BF.md'
    const decoded =
      '/Users/test/work-space/workspace-test/workspace/PPT美化方案_讨论稿.md'
    expect(classifyMarkdownHref(encoded)).toEqual({
      type: 'file',
      href: decoded,
      path: decoded
    })
    expect(markdownLinkAccessKey(encoded)).toBe(markdownLinkAccessKey(decoded))
  })

  it('extracts standard and angle-bracket markdown destinations', () => {
    const markdown =
      '见 [a](/tmp/a.docx) 与 [b](</tmp/path with space/b.docx>) 以及 [web](https://example.com/x)。'
    expect(extractMarkdownLinkHrefs(markdown)).toEqual([
      '/tmp/a.docx',
      '/tmp/path with space/b.docx',
      'https://example.com/x'
    ])
  })

  it('resolves file reference access status', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-'))
    const existing = path.join(dir, 'report.docx')
    writeFileSync(existing, 'hello')
    const missing = path.join(dir, 'missing.docx')

    const resolutions = await resolveReferencePathsAccess({
      references: [
        { resourceType: 'file', path: existing },
        { resourceType: 'file', path: missing }
      ]
    })

    expect(resolutions).toEqual([
      expect.objectContaining({ resourceType: 'file', accessStatus: 'accessible' }),
      expect.objectContaining({ resourceType: 'file', accessStatus: 'unavailable' })
    ])
  })

  it('builds linkAccess sidecar for files only without rewriting markdown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-'))
    const existing = path.join(dir, 'report.docx')
    writeFileSync(existing, 'hello')

    const markdown = `结论见 [report.docx](${existing}) 与 [missing](${path.join(dir, 'missing.docx')}) 以及 [规则](https://example.com/rules)。`
    const linkAccess = await resolveDeliveryLinkAccess(markdown)

    expect(markdown).toContain(`[report.docx](${existing})`)
    expect(linkAccess).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: existing,
          resourceType: 'file',
          accessStatus: 'accessible'
        }),
        expect.objectContaining({
          resourceType: 'file',
          accessStatus: 'unavailable'
        })
      ])
    )
    expect(linkAccess.every((entry) => entry.resourceType === 'file')).toBe(true)
    expect(linkAccess.some((entry) => entry.href.includes('example.com'))).toBe(false)
    expect(findMarkdownLinkAccess(linkAccess, existing)?.accessStatus).toBe('accessible')
    expect(markdownLinkAccessKey(existing)).toContain('file')
  })

  it('matches percent-encoded render hrefs against unicode sidecar entries', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-cn-'))
    const existing = path.join(dir, 'PPT美化方案_讨论稿.md')
    writeFileSync(existing, '# note')
    const markdown = `见 [讨论稿](<${existing}>)`
    const linkAccess = await resolveDeliveryLinkAccess(markdown)
    const encodedHref = existing
      .split(path.sep)
      .map((segment, index) => (index === 0 && segment === '' ? '' : encodeURIComponent(segment)))
      .join('/')

    expect(findMarkdownLinkAccess(linkAccess, encodedHref)?.accessStatus).toBe('accessible')
    expect(
      resolveMarkdownLinkForRender({
        href: encodedHref,
        linkAccess,
        label: '讨论稿'
      })
    ).toEqual({
      mode: 'openable',
      reference: {
        resourceType: 'file',
        label: '讨论稿',
        path: existing.replace(/\\/g, '/')
      }
    })
  })

  it('keeps http(s) links openable without linkAccess sidecar', () => {
    expect(
      resolveMarkdownLinkForRender({
        href: 'https://example.com/rules',
        linkAccess: [],
        label: '规则'
      })
    ).toEqual({
      mode: 'openable',
      reference: {
        resourceType: 'web',
        label: '规则',
        path: 'https://example.com/rules'
      }
    })
  })

  it('dedupes repeated destinations before access checks', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-'))
    const existing = path.join(dir, 'report.docx')
    writeFileSync(existing, 'hello')
    const markdown = `[one](${existing}) and [two](${existing})`
    const linkAccess = await resolveDeliveryLinkAccess(markdown)
    expect(linkAccess).toHaveLength(1)
  })
})

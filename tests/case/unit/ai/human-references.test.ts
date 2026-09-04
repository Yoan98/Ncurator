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

  it('builds linkAccess sidecar without rewriting markdown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-'))
    const existing = path.join(dir, 'report.docx')
    writeFileSync(existing, 'hello')

    const markdown = `结论见 [report.docx](${existing}) 与 [missing](${path.join(dir, 'missing.docx')})。`
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
    expect(findMarkdownLinkAccess(linkAccess, existing)?.accessStatus).toBe('accessible')
    expect(markdownLinkAccessKey(existing)).toContain('file')
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

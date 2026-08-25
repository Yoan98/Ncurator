import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildNcuratorRefHref } from '../../../../src/shared/ncuratorRef'
import { resolveReferencePathsAccess } from '../../../../src/main/services/ai/human/shared/evidenceReferenceAccess'
import { injectReferenceAccessStatus } from '../../../../src/main/services/ai/human/shared/referenceAccessMarkdown'

describe('ai unit human references', () => {
  it('builds evidence reference href with the resolved access status', () => {
    expect(
      buildNcuratorRefHref({
        kind: 'reference',
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        resourceType: 'file',
        accessStatus: 'accessible'
      })
    ).toContain('accessStatus=accessible')
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

  it('injects accessStatus into evidence reference links in delivery markdown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncurator-ref-'))
    const existing = path.join(dir, 'report.docx')
    writeFileSync(existing, 'hello')

    const label = 'report.docx'
    const encodedPath = existing.replace(/%/g, '%25').replace(/&/g, '%26')
    const markdown = `结论见 [${label}](ncurator://ref?kind=reference&resourceType=file&label=${encodeURIComponent(label)}&path=${encodedPath})。`

    const result = await injectReferenceAccessStatus(markdown)

    expect(result).toContain('kind=reference')
    expect(result).toContain('accessStatus=accessible')
  })
})

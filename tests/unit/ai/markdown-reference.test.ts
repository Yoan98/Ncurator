import { describe, expect, it } from 'vitest'
import { parseRefHref } from '../../../src/renderer/src/components/markdownReference'

describe('ai unit markdown reference helpers', () => {
  it('parses ncurator reference href', () => {
    expect(
      parseRefHref(
        'ncurator://ref?label=%E6%8A%A5%E5%91%8A.docx&path=%2Ftmp%2Fworkspace%2Freport.docx&kind=internal'
      )
    ).toEqual({
      type: 'reference',
      label: '报告.docx',
      path: '/tmp/workspace/report.docx',
      kind: 'internal'
    })
  })

  it('passes through normal href values', () => {
    expect(parseRefHref('https://openai.com')).toEqual({
      type: 'normal',
      href: 'https://openai.com'
    })
  })
})

import { describe, expect, it } from 'vitest'
import { parseRefHref } from '../../../../src/renderer/src/components/markdownReference'

describe('ai unit markdown reference helpers', () => {
  it('parses ncurator reference href', () => {
    expect(
      parseRefHref(
        'ncurator://ref?kind=reference&resourceType=file&label=%E6%8A%A5%E5%91%8A.docx&path=%2Ftmp%2Fworkspace%2Freport.docx'
      )
    ).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      label: '报告.docx',
      path: '/tmp/workspace/report.docx'
    })
  })

  it('rejects ncurator reference href values without kind', () => {
    expect(
      parseRefHref(
        'ncurator://ref?label=%E6%8A%A5%E5%91%8A.docx&path=%2Ftmp%2Fworkspace%2Freport.docx'
      )
    ).toEqual({
      type: 'normal',
      href: 'ncurator://ref?label=%E6%8A%A5%E5%91%8A.docx&path=%2Ftmp%2Fworkspace%2Freport.docx'
    })
  })

  it('infers file resource type when resourceType is missing', () => {
    expect(
      parseRefHref(
        'ncurator://ref?kind=reference&label=%E6%8A%A5%E5%91%8A.docx&path=%2Ftmp%2Fworkspace%2Freport.docx'
      )
    ).toEqual({
      type: 'reference',
      kind: 'reference',
      resourceType: 'file',
      label: '报告.docx',
      path: '/tmp/workspace/report.docx'
    })
  })

  it('infers web resource type when resourceType is missing and path is a URL', () => {
    expect(parseRefHref('ncurator://ref?kind=normal&label=OpenAI&path=https://openai.com')).toEqual(
      {
        type: 'reference',
        kind: 'normal',
        resourceType: 'web',
        label: 'OpenAI',
        path: 'https://openai.com'
      }
    )
  })

  it('passes through normal href values', () => {
    expect(parseRefHref('https://openai.com')).toEqual({
      type: 'normal',
      href: 'https://openai.com'
    })
  })
})

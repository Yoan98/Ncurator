import { describe, expect, it } from 'vitest'
import { repairMarkdownLinkDestinations } from '../../../../src/shared/markdownLink'
import {
  fileExtensionOf,
  imageMimeFromPath,
  isImageFilePath
} from '../../../../src/shared/imageFiles'
import { getFileIconKind } from '../../../../src/renderer/src/utils/fileIcons'

describe('repairMarkdownLinkDestinations', () => {
  it('wraps destinations that contain spaces', () => {
    expect(repairMarkdownLinkDestinations('[报告](/Users/me/My Docs/a.pdf)')).toBe(
      '[报告](</Users/me/My Docs/a.pdf>)'
    )
    expect(repairMarkdownLinkDestinations('![封面](/Users/me/My Docs/cover.png)')).toBe(
      '![封面](</Users/me/My Docs/cover.png>)'
    )
    expect(repairMarkdownLinkDestinations('[方案](D:\\工作\\方案 v2.docx)')).toBe(
      '[方案](<D:\\工作\\方案 v2.docx>)'
    )
    expect(repairMarkdownLinkDestinations('[站点](https://example.com/a b)')).toBe(
      '[站点](<https://example.com/a b>)'
    )
  })

  it('keeps already valid destinations untouched', () => {
    expect(repairMarkdownLinkDestinations('[a](/tmp/a.md)')).toBe('[a](/tmp/a.md)')
    expect(repairMarkdownLinkDestinations('[a](</tmp/a b.md>)')).toBe('[a](</tmp/a b.md>)')
    expect(repairMarkdownLinkDestinations('[a](/tmp/a.md "标题")')).toBe('[a](/tmp/a.md "标题")')
    expect(repairMarkdownLinkDestinations('[a](见 附录 B)')).toBe('[a](见 附录 B)')
  })

  it('never rewrites code blocks or inline code', () => {
    const fenced = ['```', '[报告](/Users/me/My Docs/a.pdf)', '```'].join('\n')
    expect(repairMarkdownLinkDestinations(fenced)).toBe(fenced)
    const inline = '`[报告](/Users/me/My Docs/a.pdf)`'
    expect(repairMarkdownLinkDestinations(inline)).toBe(inline)
  })

  it('handles several links in one paragraph', () => {
    expect(repairMarkdownLinkDestinations('[a](/x/A b.md) 与 [b](/y/C d.md)')).toBe(
      '[a](</x/A b.md>) 与 [b](</y/C d.md>)'
    )
  })
})

describe('image file metadata', () => {
  it('detects image paths by extension', () => {
    expect(isImageFilePath('/tmp/a.PNG')).toBe(true)
    expect(isImageFilePath('/tmp/a.jpeg')).toBe(true)
    expect(isImageFilePath('/tmp/a.md')).toBe(false)
    expect(fileExtensionOf('/tmp/.gitignore')).toBe('')
  })

  it('maps extensions to mime types', () => {
    expect(imageMimeFromPath('/tmp/a.jpg')).toBe('image/jpeg')
    expect(imageMimeFromPath('/tmp/a.svg')).toBe('image/svg+xml')
    expect(imageMimeFromPath('/tmp/a.unknown')).toBe('application/octet-stream')
  })
})

describe('reference icon kind', () => {
  it('separates images from generic files', () => {
    expect(getFileIconKind('/tmp/cover.png')).toBe('image')
    expect(getFileIconKind('/tmp/notes.md')).toBe('markdown')
    expect(getFileIconKind('/tmp/report.pdf')).toBe('pdf')
    expect(getFileIconKind('/tmp/archive.bin')).toBe('file')
  })
})

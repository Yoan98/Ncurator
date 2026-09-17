import { describe, expect, it } from 'vitest'
import {
  dirnamePath,
  joinFsPath,
  resolveMarkdownImageLocalPath
} from '../../../../src/shared/markdownImagePath'

describe('markdownImagePath', () => {
  it('resolves relative paths against the markdown file directory', () => {
    expect(
      resolveMarkdownImageLocalPath(
        '/Users/test/docs/note.md',
        './media/cover.png'
      )
    ).toBe('/Users/test/docs/media/cover.png')

    expect(
      resolveMarkdownImageLocalPath(
        '/Users/test/docs/note.md',
        '../assets/a.jpg'
      )
    ).toBe('/Users/test/assets/a.jpg')
  })

  it('keeps absolute and file:// local paths', () => {
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', '/tmp/pic.png')).toBe('/tmp/pic.png')
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', 'file:///tmp/pic.png')).toBe('/tmp/pic.png')
  })

  it('does not treat remote or in-memory urls as local paths', () => {
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', 'https://cdn.example/a.png')).toBeNull()
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', 'http://cdn.example/a.png')).toBeNull()
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', 'data:image/png;base64,xx')).toBeNull()
    expect(resolveMarkdownImageLocalPath('/tmp/a.md', 'blob:https://x/1')).toBeNull()
  })

  it('normalizes dirname and join helpers', () => {
    expect(dirnamePath('/Users/test/docs/note.md')).toBe('/Users/test/docs')
    expect(joinFsPath('/Users/test/docs', 'media/./x.png')).toBe('/Users/test/docs/media/x.png')
  })
})

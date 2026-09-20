import { describe, expect, it } from 'vitest'
import {
  readImageDisplayName,
  readImagePathsFromInput
} from '../../../../src/renderer/src/components/workbench/readImageThumbUtils'

describe('read_image activity thumb helpers', () => {
  it('reads trimmed paths from tool input', () => {
    expect(
      readImagePathsFromInput({
        paths: [' /tmp/a.png ', '', 'https://example.com/b.jpg', 12, null]
      } as never)
    ).toEqual(['/tmp/a.png', 'https://example.com/b.jpg'])
    expect(readImagePathsFromInput(undefined)).toEqual([])
    expect(readImagePathsFromInput({} as never)).toEqual([])
  })

  it('derives display names from local paths and remote urls', () => {
    expect(readImageDisplayName('/Users/me/Photos/cover.png')).toBe('cover.png')
    expect(readImageDisplayName('C:\\Users\\me\\cover.webp')).toBe('cover.webp')
    expect(readImageDisplayName('https://cdn.example.com/assets/shot%20one.jpg?x=1')).toBe(
      'shot one.jpg'
    )
  })
})

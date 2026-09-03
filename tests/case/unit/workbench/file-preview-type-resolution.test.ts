import { describe, expect, it } from 'vitest'
import { resolveRegisteredPreviewType } from '../../../../src/renderer/src/components/fileRenders/capabilities'

describe('file preview type resolution', () => {
  it('resolves type from file path when display name has no extension', () => {
    expect(
      resolveRegisteredPreviewType(
        '日报/2025-04-07日报',
        undefined,
        undefined,
        '/Users/test/work-space/workspace-test/workspace/日报/2025-04-07日报.docx'
      )
    ).toBe('docx')
  })

  it('still prefers an explicit file name extension', () => {
    expect(
      resolveRegisteredPreviewType(
        'notes.md',
        undefined,
        undefined,
        '/tmp/notes.docx'
      )
    ).toBe('md')
  })
})

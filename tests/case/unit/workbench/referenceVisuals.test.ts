import { describe, expect, it } from 'vitest'
import type { SelectedReference } from '../../../../src/shared/types'
import {
  getReferenceVisualKind,
  getReferenceVisualSpec
} from '../../../../src/renderer/src/components/workbench/composer/referenceVisuals'

const createFileReference = (input: {
  name: string
  relativePath?: string
  fileExt?: string
}): SelectedReference => ({
  kind: 'file',
  workspaceId: 'workspace-1',
  nodeId: `file:${input.relativePath || input.name}`,
  name: input.name,
  relativePath: input.relativePath || input.name,
  absolutePath: `/workspace/${input.relativePath || input.name}`,
  fileExt: input.fileExt,
  kbDocumentIds: [],
  kbAvailability: 'indexed'
})

describe('reference visual spec', () => {
  it('maps directory and web references to dedicated visual kinds', () => {
    const directory: SelectedReference = {
      kind: 'directory',
      workspaceId: 'workspace-1',
      nodeId: 'dir:docs',
      name: 'docs',
      relativePath: 'docs',
      absolutePath: '/workspace/docs',
      kbDocumentIds: [],
      kbAvailability: 'indexed',
      indexedFileCount: 1,
      notIndexedFileCount: 0
    }
    const web: SelectedReference = {
      kind: 'web',
      workspaceId: 'workspace-1',
      webSourceId: 'web-1',
      name: 'Example',
      url: 'https://example.com',
      kbDocumentIds: [],
      kbAvailability: 'indexed'
    }

    expect(getReferenceVisualKind(directory)).toBe('directory')
    expect(getReferenceVisualKind(web)).toBe('web')
  })

  it('maps known file extensions with fileExt precedence and path fallback', () => {
    expect(
      getReferenceVisualKind(createFileReference({ name: 'report.pdf', fileExt: 'PDF' }))
    ).toBe('pdf')
    expect(
      getReferenceVisualKind(
        createFileReference({
          name: 'notes.md',
          relativePath: 'docs/notes.md',
          fileExt: '.docx'
        })
      )
    ).toBe('docx')
    expect(
      getReferenceVisualKind(
        createFileReference({ name: 'fallback.PDF', relativePath: 'docs/fallback.PDF' })
      )
    ).toBe('pdf')
  })

  it('keeps markdown and unknown files on the generic file visual spec', () => {
    const noExtension = getReferenceVisualSpec(createFileReference({ name: 'README' }))
    const textFile = getReferenceVisualSpec(createFileReference({ name: 'notes.txt' }))
    const markdownFile = getReferenceVisualSpec(createFileReference({ name: 'brief.markdown' }))
    const mdFile = getReferenceVisualSpec(createFileReference({ name: 'brief.md' }))

    expect(noExtension.kind).toBe('file')
    expect(textFile.kind).toBe('file')
    expect(textFile.documentLabel).toBeUndefined()
    expect(markdownFile.kind).toBe('file')
    expect(markdownFile.documentLabel).toBeUndefined()
    expect(mdFile.kind).toBe('file')
    expect(mdFile.documentLabel).toBeUndefined()
  })
})

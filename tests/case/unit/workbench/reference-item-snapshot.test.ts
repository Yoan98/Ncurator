import { describe, expect, it } from 'vitest'
import type {
  FileReference,
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../../src/shared/types'
import { buildWorkspaceReferenceItemsFromCurrentTree } from '../../../../src/main/services/sourceScope/selection'

const workspace: WorkspaceSource = {
  id: 'workspace-current-tree',
  name: '当前目录工作区',
  root_path: '/tmp/current-tree-workspace',
  created_at: 1,
  updated_at: 1
}

const fileEntry = (input: {
  name: string
  relativePath: string
  size: number
  mtimeMs: number
  supportedForIndex?: boolean
}): WorkspaceTreeEntry => ({
  id: `file:${input.relativePath}`,
  workspace_id: workspace.id,
  parent_id: 'directory:docs',
  kind: 'file',
  name: input.name,
  relative_path: input.relativePath,
  absolute_path: `${workspace.root_path}/${input.relativePath}`,
  file_ext: input.name.split('.').at(-1),
  supported_for_index: input.supportedForIndex ?? true,
  size: input.size,
  mtime_ms: input.mtimeMs
})

const indexRecord = (input: {
  relativePath: string
  name: string
  size: number
  mtimeMs: number
  documentId: string
}): WorkspaceFileIndexRecord => ({
  id: `index:${input.relativePath}`,
  workspace_id: workspace.id,
  relative_path: input.relativePath,
  absolute_path: `${workspace.root_path}/${input.relativePath}`,
  name: input.name,
  file_ext: input.name.split('.').at(-1) || '',
  size: input.size,
  mtime_ms: input.mtimeMs,
  index_status: 'indexed',
  document_id: input.documentId,
  created_at: 1,
  updated_at: 1
})

describe('workbench reference item snapshot', () => {
  it('uses the current tree for @ candidates and only uses current index records for availability', () => {
    const entries: WorkspaceTreeEntry[] = [
      {
        id: 'directory:docs',
        workspace_id: workspace.id,
        kind: 'directory',
        name: 'docs',
        relative_path: 'docs',
        absolute_path: `${workspace.root_path}/docs`,
        supported_for_index: false
      },
      fileEntry({
        name: 'indexed.md',
        relativePath: 'docs/indexed.md',
        size: 10,
        mtimeMs: 100
      }),
      fileEntry({
        name: 'changed.docx',
        relativePath: 'docs/changed.docx',
        size: 25,
        mtimeMs: 200
      }),
      fileEntry({
        name: '新人入职指南_简化版.docx',
        relativePath: 'docs/新人入职指南_简化版.docx',
        size: 30,
        mtimeMs: 300
      }),
      fileEntry({
        name: 'notes.bin',
        relativePath: 'docs/notes.bin',
        size: 40,
        mtimeMs: 400,
        supportedForIndex: false
      })
    ]
    const references = buildWorkspaceReferenceItemsFromCurrentTree({
      workspace,
      entries,
      records: [
        indexRecord({
          name: 'indexed.md',
          relativePath: 'docs/indexed.md',
          size: 10,
          mtimeMs: 100,
          documentId: 'doc-indexed'
        }),
        indexRecord({
          name: 'changed.docx',
          relativePath: 'docs/changed.docx',
          size: 20,
          mtimeMs: 150,
          documentId: 'doc-changed'
        }),
        indexRecord({
          name: 'deleted.md',
          relativePath: 'docs/deleted.md',
          size: 5,
          mtimeMs: 50,
          documentId: 'doc-deleted'
        })
      ]
    })
    const getFile = (name: string): FileReference => {
      const reference = references.find(
        (item): item is FileReference => item.kind === 'file' && item.name === name
      )
      if (!reference) throw new Error(`missing file reference: ${name}`)
      return reference
    }
    const directory = references.find(
      (item) => item.kind === 'directory' && item.relativePath === 'docs'
    )

    expect(references.map((reference) => reference.name)).toEqual(
      expect.arrayContaining([
        'docs',
        'indexed.md',
        'changed.docx',
        '新人入职指南_简化版.docx',
        'notes.bin'
      ])
    )
    expect(references.some((reference) => reference.name === 'deleted.md')).toBe(false)
    expect(getFile('indexed.md')).toMatchObject({
      kbAvailability: 'indexed',
      kbDocumentIds: ['doc-indexed']
    })
    expect(getFile('changed.docx')).toMatchObject({
      kbAvailability: 'not_indexed',
      kbDocumentIds: []
    })
    expect(getFile('新人入职指南_简化版.docx')).toMatchObject({
      absolutePath: '/tmp/current-tree-workspace/docs/新人入职指南_简化版.docx',
      kbAvailability: 'not_indexed',
      kbDocumentIds: []
    })
    expect(directory).toMatchObject({
      kbAvailability: 'partial',
      kbDocumentIds: ['doc-indexed'],
      indexedFileCount: 1,
      notIndexedFileCount: 2
    })
  })
})

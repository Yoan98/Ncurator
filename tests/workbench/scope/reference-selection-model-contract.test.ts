import { describe, it } from 'vitest'
import {
  buildWebReferenceItem,
  buildWorkspaceDefaultDocumentIds,
  buildWorkspaceReferenceItems,
  shouldIncludeReferenceInSearch
} from '../../../src/main/services/sourceScope/selection'
import type { WebSourceRecord, WorkspaceNode, WorkspaceSource } from '../../../src/shared/types'
import { runBackendCase } from '../../harness/backend/run-backend-case'

const NOW = 1_711_111_111_111

const WORKSPACE: WorkspaceSource = {
  id: 'workspace-1',
  name: 'NCurator',
  root_path: '/tmp/ncurator',
  status: 'prepared',
  created_at: NOW,
  updated_at: NOW
}

const WORKSPACE_NODES: WorkspaceNode[] = [
  {
    id: 'dir-prd',
    workspace_id: WORKSPACE.id,
    kind: 'directory',
    name: 'PRD',
    relative_path: 'docs/prd',
    absolute_path: '/tmp/ncurator/docs/prd',
    exists: true,
    prepare_status: 'not_prepared',
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'file-a',
    workspace_id: WORKSPACE.id,
    parent_id: 'dir-prd',
    kind: 'file',
    name: 'a.docx',
    relative_path: 'docs/prd/a.docx',
    absolute_path: '/tmp/ncurator/docs/prd/a.docx',
    file_ext: 'docx',
    exists: true,
    prepare_status: 'prepared',
    document_id: 'doc-a',
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'file-b',
    workspace_id: WORKSPACE.id,
    parent_id: 'dir-prd',
    kind: 'file',
    name: 'b.docx',
    relative_path: 'docs/prd/b.docx',
    absolute_path: '/tmp/ncurator/docs/prd/b.docx',
    file_ext: 'docx',
    exists: true,
    prepare_status: 'prepared',
    document_id: 'doc-a',
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'file-c',
    workspace_id: WORKSPACE.id,
    parent_id: 'dir-prd',
    kind: 'file',
    name: 'c.docx',
    relative_path: 'docs/prd/c.docx',
    absolute_path: '/tmp/ncurator/docs/prd/c.docx',
    file_ext: 'docx',
    exists: true,
    prepare_status: 'not_prepared',
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'file-root',
    workspace_id: WORKSPACE.id,
    kind: 'file',
    name: 'README.md',
    relative_path: 'README.md',
    absolute_path: '/tmp/ncurator/README.md',
    file_ext: 'md',
    exists: true,
    prepare_status: 'prepared',
    document_id: 'doc-root',
    created_at: NOW,
    updated_at: NOW
  }
]

const INDEXED_WEB_SOURCE: WebSourceRecord = {
  id: 'web-1',
  identity_kind: 'normalized_url',
  normalized_url: 'https://example.com/rules',
  url: 'https://example.com/rules',
  title: '发布规范',
  document_id: 'web-doc-1',
  import_status: 2,
  created_at: NOW,
  updated_at: NOW
}

const NOT_INDEXED_WEB_SOURCE: WebSourceRecord = {
  id: 'web-2',
  identity_kind: 'normalized_url',
  normalized_url: 'https://example.com/draft',
  url: 'https://example.com/draft',
  title: '草稿网页',
  import_status: 1,
  created_at: NOW,
  updated_at: NOW
}

describe('workbench scope backend', () => {
  it('reference-selection-model-contract', async () => {
    await runBackendCase({
      caseId: 'reference-selection-model-contract',
      domain: 'workbench',
      suite: 'scope',
      description: '验证 reference 聚合、kbAvailability 和方案 B 的工作区默认 KB 范围收口。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const references = buildWorkspaceReferenceItems(WORKSPACE, WORKSPACE_NODES)
        const directoryReference = references.find(
          (reference) => reference.kind === 'directory' && reference.relativePath === 'docs/prd'
        )
        const indexedFileReference = references.find(
          (reference) => reference.kind === 'file' && reference.relativePath === 'docs/prd/a.docx'
        )
        const notIndexedFileReference = references.find(
          (reference) => reference.kind === 'file' && reference.relativePath === 'docs/prd/c.docx'
        )
        const indexedWebReference = buildWebReferenceItem(INDEXED_WEB_SOURCE)
        const notIndexedWebReference = buildWebReferenceItem(NOT_INDEXED_WEB_SOURCE)

        return {
          directoryReference,
          indexedFileReference,
          notIndexedFileReference,
          indexedWebReference,
          notIndexedWebReference,
          workspaceDefaultDocumentIds: buildWorkspaceDefaultDocumentIds(WORKSPACE_NODES),
          searchableReferenceKinds: [
            directoryReference,
            indexedFileReference,
            notIndexedFileReference,
            indexedWebReference,
            notIndexedWebReference
          ]
            .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference))
            .filter(shouldIncludeReferenceInSearch)
            .map((reference) => `${reference.kind}:${reference.name}`)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.directoryReference?.kbAvailability === 'partial' &&
            result.directoryReference.indexedFileCount === 2 &&
            result.directoryReference.notIndexedFileCount === 1 &&
            JSON.stringify(result.directoryReference.kbDocumentIds) === JSON.stringify(['doc-a']),
          {
            name: 'directory-reference-aggregates-indexed-descendants',
            message:
              '目录 reference 应聚合所有已索引后代文件的 document id 并去重，同时把 kbAvailability 标成 partial。',
            data: {
              directoryReference: result.directoryReference
            }
          }
        )

        runtime.assertThat(
          result.indexedFileReference?.kbAvailability === 'indexed' &&
            JSON.stringify(result.indexedFileReference.kbDocumentIds) === JSON.stringify(['doc-a']) &&
            result.notIndexedFileReference?.kbAvailability === 'not_indexed' &&
            result.notIndexedFileReference.kbDocumentIds.length === 0,
          {
            name: 'file-reference-reflects-indexed-and-not-indexed-states',
            message:
              '文件 reference 应在已索引和未索引两种场景下分别映射为 indexed 与 not_indexed，并只在已索引时提供 kbDocumentIds。',
            data: {
              indexedFileReference: result.indexedFileReference,
              notIndexedFileReference: result.notIndexedFileReference
            }
          }
        )

        runtime.assertThat(
          result.indexedWebReference.kbAvailability === 'indexed' &&
            JSON.stringify(result.indexedWebReference.kbDocumentIds) === JSON.stringify(['web-doc-1']) &&
            result.notIndexedWebReference.kbAvailability === 'not_indexed' &&
            result.notIndexedWebReference.kbDocumentIds.length === 0,
          {
            name: 'web-reference-maps-kb-availability-consistently',
            message:
              '网页 reference 应按是否可检索映射为 indexed 或 not_indexed，并与本地 reference 共用统一的 kbDocumentIds 聚合语义。',
            data: {
              indexedWebReference: result.indexedWebReference,
              notIndexedWebReference: result.notIndexedWebReference
            }
          }
        )

        runtime.assertThat(
          JSON.stringify(result.workspaceDefaultDocumentIds) === JSON.stringify(['doc-a', 'doc-root']) &&
            JSON.stringify(result.searchableReferenceKinds) ===
              JSON.stringify(['directory:PRD', 'file:a.docx', 'web:发布规范']),
          {
            name: 'workspace-default-kb-scope-and-search-filter-stay-aligned',
            message:
              '方案 B 下仅绑定工作区时，应默认收口到工作区全部已索引文件；搜索模式同时只允许 kbDocumentIds 非空的 reference 进入候选。',
            data: {
              workspaceDefaultDocumentIds: result.workspaceDefaultDocumentIds,
              searchableReferenceKinds: result.searchableReferenceKinds
            }
          }
        )
      }
    })
  })
})

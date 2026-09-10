import { describe, it } from 'vitest'
import type { WorkspaceFileIndexRecord, WorkspaceSource } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const NOW = 1_716_000_000_000

const WORKSPACE: WorkspaceSource = {
  id: 'settings-workspace-remove-contract',
  root_path: '/tmp/settings-workspace-remove-contract',
  created_at: NOW,
  updated_at: NOW
}

const FILE_RECORD: WorkspaceFileIndexRecord = {
  id: 'settings-workspace-remove-contract-file',
  workspace_id: WORKSPACE.id,
  relative_path: 'docs/brief.docx',
  absolute_path: `${WORKSPACE.root_path}/docs/brief.docx`,
  name: 'brief.docx',
  file_ext: 'docx',
  size: 128,
  mtime_ms: NOW,
  content_hash: 'fixture-hash',
  index_status: 'indexed',
  document_id: 'settings-workspace-remove-contract-doc',
  indexed_at: NOW,
  last_checked_at: NOW,
  created_at: NOW,
  updated_at: NOW
}

describe('unit workspace backend', () => {
  it('workspace-remove-source-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-remove-source-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'workspace',
      groups: ['core'],
      description: '移除文件地址后，该地址及其文件索引记录应一并清理；全局网页资料不受影响。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.storageService.workspace.saveWorkspace(WORKSPACE)
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(WORKSPACE.id, [
          FILE_RECORD
        ])

        await runtime.storageService.workspace.deleteWorkspace(WORKSPACE.id)

        const workspaces = await runtime.storageService.workspace.listWorkspaces()
        const fileRecords = await runtime.storageService.workspace.listWorkspaceFileIndexRecords(
          WORKSPACE.id
        )

        return {
          remainingWorkspaceIds: workspaces.map((item) => item.id),
          remainingFileRecordIds: fileRecords.map((item) => item.id)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(!result.remainingWorkspaceIds.includes(WORKSPACE.id), {
          name: 'removed-workspace-disappears-from-settings-list-source',
          message:
            '移除成功后，后续工作空间列表查询不应再返回该工作空间，对齐 SET-WORKSPACE-006-AC2。',
          data: result
        })

        runtime.assertThat(result.remainingFileRecordIds.length === 0, {
          name: 'removed-workspace-clears-file-index-records',
          message:
            '移除成功后，该文件地址下的索引记录应一并消失，避免残留资料继续进入资料范围，对齐 SET-WORKSPACE-006-AC2。',
          data: result
        })
      }
    })
  })
})

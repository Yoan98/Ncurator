import { describe, it } from 'vitest'
import type { WebSourceRecord, WorkspaceNode, WorkspaceSource } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const NOW = 1_716_000_000_000

const WORKSPACE: WorkspaceSource = {
  id: 'settings-workspace-remove-contract',
  name: '待移除工作区',
  root_path: '/tmp/settings-workspace-remove-contract',
  status: 'prepared',
  created_at: NOW,
  updated_at: NOW
}

const WORKSPACE_NODES: WorkspaceNode[] = [
  {
    id: 'settings-workspace-remove-contract-dir',
    workspace_id: WORKSPACE.id,
    kind: 'directory',
    name: 'docs',
    relative_path: 'docs',
    absolute_path: `${WORKSPACE.root_path}/docs`,
    exists: true,
    prepare_status: 'not_prepared',
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'settings-workspace-remove-contract-file',
    workspace_id: WORKSPACE.id,
    parent_id: 'settings-workspace-remove-contract-dir',
    kind: 'file',
    name: 'brief.md',
    relative_path: 'docs/brief.md',
    absolute_path: `${WORKSPACE.root_path}/docs/brief.md`,
    file_ext: 'md',
    exists: true,
    prepare_status: 'prepared',
    document_id: 'settings-workspace-remove-contract-doc',
    created_at: NOW,
    updated_at: NOW
  }
]

const WEB_SOURCE: WebSourceRecord = {
  id: 'settings-workspace-remove-contract-web',
  workspace_id: WORKSPACE.id,
  identity_kind: 'normalized_url',
  normalized_url: 'https://example.com/remove-contract',
  url: 'https://example.com/remove-contract',
  title: '待移除网页资料',
  document_id: 'settings-workspace-remove-contract-web-doc',
  import_status: 2,
  created_at: NOW,
  updated_at: NOW
}

describe('settings workspace backend', () => {
  it('workspace-remove-source-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-remove-source-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '移除工作空间后，列表、节点与网页资料数据源都不再返回该工作空间内容。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.storageService.workspace.saveWorkspace(WORKSPACE)
        await runtime.storageService.workspace.replaceWorkspaceNodes(WORKSPACE.id, WORKSPACE_NODES)
        await runtime.storageService.webSource.saveWebSource(WEB_SOURCE)

        await runtime.storageService.workspace.deleteWorkspace(WORKSPACE.id)

        const workspaces = await runtime.storageService.workspace.listWorkspaces()
        const nodes = await runtime.storageService.workspace.listWorkspaceNodes({
          workspaceId: WORKSPACE.id
        })
        const webSources = await runtime.storageService.webSource.listWebSources(WORKSPACE.id)

        return {
          remainingWorkspaceIds: workspaces.map((item) => item.id),
          remainingNodeCount: nodes.length,
          remainingWebSourceIds: webSources.map((item) => item.id)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(!result.remainingWorkspaceIds.includes(WORKSPACE.id), {
          name: 'removed-workspace-disappears-from-settings-list-source',
          message:
            '移除成功后，后续工作空间列表查询不应再返回该工作空间，对齐 SET-WORKSPACE-006-AC2。',
          data: result
        })

        runtime.assertThat(
          result.remainingNodeCount === 0 &&
            !result.remainingWebSourceIds.includes(WEB_SOURCE.id),
          {
            name: 'removed-workspace-clears-followup-reference-sources',
            message:
              '移除成功后，该工作空间的本地节点与网页资料数据源都应同时消失，对齐 SET-WORKSPACE-006-AC2。',
            data: result
          }
        )
      }
    })
  })
})

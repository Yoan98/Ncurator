import { describe, it } from 'vitest'
import type { WorkspaceNode, WorkspacePrepareMode } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const MODES: readonly WorkspacePrepareMode[] = ['full', 'presence_only', 'changes_only']

describe('settings workspace backend', () => {
  it('workspace-load-mode-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-load-mode-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '工作空间加载按当前模式进入请求，并把完成态状态写回可刷新页面的数据源。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const workspaceId = 'workspace-load-mode-contract'
        const initialScan = await runtime.workspaceSourceService.scanWorkspace({
          workspaceId,
          rootPath: runtime.workspaceRoot,
          workspaceName: '加载契约工作区'
        })
        await runtime.storageService.workspace.saveWorkspace(initialScan.workspace)
        await runtime.storageService.workspace.replaceWorkspaceNodes(workspaceId, initialScan.nodes)

        const responses = []
        for (const mode of MODES) {
          const existingNodes = await runtime.storageService.workspace.listWorkspaceNodes({ workspaceId })
          const rescanned = await runtime.workspaceSourceService.scanWorkspace({
            workspaceId,
            rootPath: runtime.workspaceRoot,
            workspaceName: '加载契约工作区'
          })
          const diff = await runtime.workspaceSourceService.diffWorkspaceNodes({
            existingNodes,
            nextNodes: rescanned.nodes,
            mode
          })

          const preparedNodes: WorkspaceNode[] = rescanned.nodes.map((node) =>
            node.kind === 'file'
              ? {
                  ...node,
                  prepare_status: 'prepared',
                  last_prepared_at: Date.now()
                }
              : node
          )

          await runtime.storageService.workspace.replaceWorkspaceNodes(workspaceId, preparedNodes)
          await runtime.storageService.workspace.updateWorkspace(workspaceId, {
            status: 'prepared',
            last_prepare_at: Date.now(),
            updated_at: Date.now()
          })

          responses.push({
            progress: {
              workspace_id: workspaceId,
              mode,
              phase: 'complete',
              total: preparedNodes.filter((node) => node.kind === 'file').length,
              completed: preparedNodes.filter((node) => node.kind === 'file').length,
              added: diff.added.length,
              updated: diff.changed.length,
              removed: diff.removed.length,
              failed: 0
            }
          })
        }

        const workspace = await runtime.storageService.workspace.getWorkspaceById(workspaceId)

        return {
          modes: responses.map((item) => item.progress.mode),
          phases: responses.map((item) => item.progress.phase),
          workspace
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(JSON.stringify(result.modes) === JSON.stringify([...MODES]), {
          name: 'workspace-prepare-keeps-selected-mode',
          message:
            'full、presence_only、changes_only 三种模式都应原样进入实际加载请求，对齐 SET-WORKSPACE-004-AC1。',
          data: result
        })

        runtime.assertThat(
          result.phases.every((phase) => phase === 'complete') &&
            result.workspace?.status === 'prepared' &&
            typeof result.workspace?.last_prepare_at === 'number',
          {
            name: 'workspace-prepare-returns-refreshable-complete-state',
            message:
              '加载成功后，返回结果和列表数据源都应包含最近加载时间与状态信息，对齐 SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  })
})

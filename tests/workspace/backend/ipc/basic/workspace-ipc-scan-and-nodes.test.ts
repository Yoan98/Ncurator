import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createWorkspaceIpcTestContext } from '../utils/workspaceIpcTestContext'

const toSortedPaths = (items: { relative_path: string }[]): string[] =>
  items.map((item) => item.relative_path).sort((left, right) => left.localeCompare(right))

test('workspace-ipc-scan-and-nodes', async () => {
  await runBackendCase({
    caseId: 'workspace-ipc-scan-and-nodes',
    caseType: 'basic',
    domain: 'workspace',
    layer: 'backend',
    suite: 'ipc',
    groups: ['basic'],
    description:
      'workspace ipc should rescan persisted workspaces and expose the refreshed node snapshot through workspace-nodes.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const context = await createWorkspaceIpcTestContext({
        userDataRoot: runtime.workspaceRoot
      })
      const rootPath = path.join(runtime.workspaceRoot, 'knowledge-pack')
      await fs.mkdir(path.join(rootPath, 'docs'), { recursive: true })
      await fs.writeFile(path.join(rootPath, 'docs', 'alpha.docx'), Buffer.from('alpha-v1'))

      const createResponse = await context.workspaceCreate({
        rootPath,
        name: '知识资料'
      })
      if (!createResponse.workspace) {
        throw new Error('workspace should exist after creation')
      }

      await fs.writeFile(path.join(rootPath, 'docs', 'beta.pdf'), Buffer.from('beta-v1'))
      const scanResponse = await context.workspaceScan({
        workspaceId: createResponse.workspace.id
      })
      const nodesResponse = await context.workspaceNodes({
        workspaceId: createResponse.workspace.id
      })
      const listResponse = await context.workspaceList()

      return {
        scanResponse,
        nodesResponse,
        listResponse
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.scanResponse.success === true &&
          result.scanResponse.progress?.phase === 'scan' &&
          result.scanResponse.progress?.added === 1,
        {
          name: 'workspace-ipc-scan-progress',
          message: 'workspace-scan should return a successful scan progress summary when new files are discovered',
          data: result.scanResponse
        }
      )

      runtime.assertThat(
        toSortedPaths(result.nodesResponse.items).join(',') ===
          ['docs', 'docs/alpha.docx', 'docs/beta.pdf'].join(','),
        {
          name: 'workspace-ipc-nodes-after-scan',
          message: 'workspace-nodes should expose the refreshed snapshot after a successful scan',
          data: {
            workspaceRoot: runtime.workspaceRoot,
            nodePaths: toSortedPaths(result.nodesResponse.items)
          }
        }
      )

      runtime.assertThat(
        result.listResponse.items[0]?.status === 'stale' &&
          typeof result.listResponse.items[0]?.last_scan_at === 'number',
        {
          name: 'workspace-ipc-workspace-state-after-scan',
          message: 'workspace-list should reflect the updated workspace status and last scan time after scanning',
          data: result.listResponse.items[0]
        }
      )
    }
  })
})

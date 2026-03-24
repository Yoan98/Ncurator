import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createWorkspaceIpcTestContext } from '../utils/workspaceIpcTestContext'

test('workspace-ipc-create-list-delete', async () => {
  await runBackendCase({
    caseId: 'workspace-ipc-create-list-delete',
    caseType: 'basic',
    domain: 'workspace',
    layer: 'backend',
    suite: 'ipc',
    groups: ['basic'],
    description:
      'workspace ipc should create, list, and delete workspaces while keeping workspace nodes in sync.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const context = await createWorkspaceIpcTestContext({
        userDataRoot: runtime.workspaceRoot
      })
      const rootPath = path.join(runtime.workspaceRoot, 'contracts')
      await fs.mkdir(path.join(rootPath, 'docs'), { recursive: true })
      await fs.writeFile(path.join(rootPath, 'docs', 'brief.docx'), Buffer.from('brief-v1'))

      const createResponse = await context.workspaceCreate({
        rootPath,
        name: '客户合同'
      })
      const listAfterCreate = await context.workspaceList()
      const nodesAfterCreate = createResponse.workspace
        ? await context.workspaceNodes({ workspaceId: createResponse.workspace.id })
        : { items: [], total: 0 }

      const deleteResponse = createResponse.workspace
        ? await context.workspaceDelete(createResponse.workspace.id)
        : { success: false }
      const listAfterDelete = await context.workspaceList()
      const nodesAfterDelete = createResponse.workspace
        ? await context.workspaceNodes({ workspaceId: createResponse.workspace.id })
        : { items: [], total: 0 }

      return {
        createResponse,
        listAfterCreate,
        nodesAfterCreate,
        deleteResponse,
        listAfterDelete,
        nodesAfterDelete
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.createResponse.success === true && Boolean(result.createResponse.workspace), {
        name: 'workspace-ipc-create-success',
        message: 'workspace-create should immediately return the created workspace payload',
        data: result.createResponse
      })

      runtime.assertThat(
        result.listAfterCreate.total === 1 &&
          result.listAfterCreate.items[0]?.name === '客户合同' &&
          result.nodesAfterCreate.total === 2,
        {
          name: 'workspace-ipc-list-after-create',
          message: 'workspace-list and workspace-nodes should immediately reflect the newly created workspace snapshot',
          data: {
            listAfterCreate: result.listAfterCreate,
            nodesAfterCreate: result.nodesAfterCreate
          }
        }
      )

      runtime.assertThat(
        result.deleteResponse.success === true &&
          result.listAfterDelete.total === 0 &&
          result.nodesAfterDelete.total === 0,
        {
          name: 'workspace-ipc-delete-cleans-up',
          message: 'workspace-delete should remove both the workspace record and its persisted nodes',
          data: {
            deleteResponse: result.deleteResponse,
            listAfterDelete: result.listAfterDelete,
            nodesAfterDelete: result.nodesAfterDelete,
            workspaceRoot: runtime.workspaceRoot
          }
        }
      )
    }
  })
})

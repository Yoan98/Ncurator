import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createWorkspaceIpcTestContext } from '../utils/workspaceIpcTestContext'

test('workspace-ipc-duplicate-root-rejected', async () => {
  await runBackendCase({
    caseId: 'workspace-ipc-duplicate-root-rejected',
    caseType: 'boundary',
    domain: 'workspace',
    layer: 'backend',
    suite: 'ipc',
    groups: ['boundary'],
    description:
      'workspace ipc should reject duplicate or nested workspace roots and keep persistence state unchanged on failure.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const context = await createWorkspaceIpcTestContext({
        userDataRoot: runtime.workspaceRoot
      })
      const rootPath = path.join(runtime.workspaceRoot, 'shared-root')
      const nestedPath = path.join(rootPath, 'nested-child')
      await fs.mkdir(nestedPath, { recursive: true })

      const firstCreate = await context.workspaceCreate({
        rootPath,
        name: '一级根目录'
      })
      const duplicateCreate = await context.workspaceCreate({
        rootPath,
        name: '重复根目录'
      })
      const nestedCreate = await context.workspaceCreate({
        rootPath: nestedPath,
        name: '嵌套根目录'
      })
      const listResponse = await context.workspaceList()

      return {
        firstCreate,
        duplicateCreate,
        nestedCreate,
        listResponse
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.firstCreate.success === true, {
        name: 'workspace-ipc-first-root-created',
        message: 'the initial workspace should still be created successfully before duplicate checks run',
        data: result.firstCreate
      })

      runtime.assertThat(
        result.duplicateCreate.success === false &&
          result.nestedCreate.success === false &&
          result.duplicateCreate.error === '工作空间之间不能重复或嵌套' &&
          result.nestedCreate.error === '工作空间之间不能重复或嵌套',
        {
          name: 'workspace-ipc-duplicate-root-errors',
          message: 'workspace-create should surface the duplicate or nested root rejection through ipc responses',
          data: {
            duplicateCreate: result.duplicateCreate,
            nestedCreate: result.nestedCreate
          }
        }
      )

      runtime.assertThat(result.listResponse.total === 1, {
        name: 'workspace-ipc-no-half-created-records',
        message: 'rejected duplicate or nested roots should not leave half-created workspace records behind',
        data: {
          listResponse: result.listResponse,
          workspaceRoot: runtime.workspaceRoot
        }
      })
    }
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { WorkspaceSourceService } from '../../../../../src/main/services/workspace/WorkspaceSourceService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

test('workspace-source-service-normalize-and-name', async () => {
  await runBackendCase({
    caseId: 'workspace-source-service-normalize-and-name',
    caseType: 'basic',
    domain: 'workspace',
    layer: 'backend',
    suite: 'source-service',
    groups: ['basic'],
    description:
      'workspace source service should normalize workspace roots and derive default or explicit display names consistently.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const service = new WorkspaceSourceService()
      const actualRoot = path.join(runtime.workspaceRoot, 'client-materials')
      await fs.mkdir(actualRoot, { recursive: true })

      const normalized = await service.normalizeWorkspaceRoot(`${actualRoot}${path.sep}`)
      const scanWithDefaultName = await service.scanWorkspace({
        workspaceId: 'workspace-default-name',
        rootPath: `${actualRoot}${path.sep}`
      })
      const scanWithExplicitName = await service.scanWorkspace({
        workspaceId: 'workspace-explicit-name',
        rootPath: actualRoot,
        workspaceName: '客户资料'
      })

      return {
        normalizedRootPath: normalized.normalizedRootPath,
        displayName: normalized.displayName,
        defaultWorkspaceName: scanWithDefaultName.workspace.name,
        explicitWorkspaceName: scanWithExplicitName.workspace.name
      }
    },
    assert: async (result, runtime) => {
      const expectedRoot = await fs.realpath(path.join(runtime.workspaceRoot, 'client-materials'))

      runtime.assertThat(result.normalizedRootPath === expectedRoot, {
        name: 'workspace-normalized-root-path',
        message: 'normalizeWorkspaceRoot should resolve the real root path instead of keeping a trailing-slash variant',
        data: result
      })

      runtime.assertThat(result.displayName === 'client-materials', {
        name: 'workspace-default-display-name',
        message: 'normalizeWorkspaceRoot should derive the default display name from the root basename',
        data: result
      })

      runtime.assertThat(result.defaultWorkspaceName === 'client-materials', {
        name: 'workspace-scan-default-name',
        message: 'scanWorkspace should reuse the basename when no explicit workspace name is provided',
        data: result
      })

      runtime.assertThat(result.explicitWorkspaceName === '客户资料', {
        name: 'workspace-explicit-name-priority',
        message: 'scanWorkspace should prefer the explicit workspace name over the inferred basename',
        data: result
      })
    }
  })
})

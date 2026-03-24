import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { WorkspaceSourceService } from '../../../../../src/main/services/workspace/WorkspaceSourceService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

test('workspace-source-service-invalid-root', async () => {
  await runBackendCase({
    caseId: 'workspace-source-service-invalid-root',
    caseType: 'boundary',
    domain: 'workspace',
    layer: 'backend',
    suite: 'source-service',
    groups: ['boundary'],
    description:
      'workspace source service should reject empty roots, plain files, and missing directories instead of creating invalid workspaces.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const service = new WorkspaceSourceService()
      const filePath = path.join(runtime.workspaceRoot, 'plain-file.txt')
      const missingPath = path.join(runtime.workspaceRoot, 'missing-root')
      await fs.writeFile(filePath, 'not-a-directory')

      let emptyRootError = ''
      let fileRootError = ''
      let missingRootError = ''

      try {
        await service.normalizeWorkspaceRoot('')
      } catch (error) {
        emptyRootError = error instanceof Error ? error.message : String(error)
      }

      try {
        await service.normalizeWorkspaceRoot(filePath)
      } catch (error) {
        fileRootError = error instanceof Error ? error.message : String(error)
      }

      try {
        await service.normalizeWorkspaceRoot(missingPath)
      } catch (error) {
        missingRootError = error instanceof Error ? error.message : String(error)
      }

      return {
        emptyRootError,
        fileRootError,
        missingRootError,
        missingPathExists: await fs
          .stat(missingPath)
          .then(() => true)
          .catch(() => false)
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.emptyRootError === '工作空间目录不能为空', {
        name: 'workspace-empty-root-rejected',
        message: 'empty root paths should be rejected before any filesystem access happens',
        data: result
      })

      runtime.assertThat(result.fileRootError === '工作空间必须是目录', {
        name: 'workspace-file-root-rejected',
        message: 'plain files should not be accepted as workspace roots',
        data: result
      })

      runtime.assertThat(result.missingRootError.length > 0, {
        name: 'workspace-missing-root-errors',
        message: 'missing directories should still surface an explicit failure instead of being silently created',
        data: result
      })

      runtime.assertThat(result.missingPathExists === false, {
        name: 'workspace-missing-root-not-created',
        message: 'normalizeWorkspaceRoot should not create a missing directory as a side effect',
        data: {
          missingPathExists: result.missingPathExists,
          workspaceRoot: runtime.workspaceRoot
        }
      })
    }
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { WorkspaceSourceService } from '../../../../../src/main/services/workspace/WorkspaceSourceService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

test('workspace-source-service-nested-root-rejected', async () => {
  await runBackendCase({
    caseId: 'workspace-source-service-nested-root-rejected',
    caseType: 'boundary',
    domain: 'workspace',
    layer: 'backend',
    suite: 'source-service',
    groups: ['boundary'],
    description:
      'workspace source service should reject duplicate or nested workspace roots before they are persisted.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const service = new WorkspaceSourceService()
      const childPath = path.join(runtime.workspaceRoot, 'nested-child')
      await fs.mkdir(childPath, { recursive: true })

      let nestedChildError = ''
      let nestedParentError = ''

      try {
        await service.assertNoNestedWorkspace(childPath, [runtime.workspaceRoot])
      } catch (error) {
        nestedChildError = error instanceof Error ? error.message : String(error)
      }

      try {
        await service.assertNoNestedWorkspace(runtime.workspaceRoot, [childPath])
      } catch (error) {
        nestedParentError = error instanceof Error ? error.message : String(error)
      }

      return {
        nestedChildError,
        nestedParentError
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.nestedChildError === '工作空间之间不能重复或嵌套', {
        name: 'workspace-nested-child-rejected',
        message: 'child workspace root should be rejected when it is nested under an existing root',
        data: result
      })

      runtime.assertThat(result.nestedParentError === '工作空间之间不能重复或嵌套', {
        name: 'workspace-nested-parent-rejected',
        message: 'parent workspace root should also be rejected when an existing root is nested under it',
        data: result
      })
    }
  })
})

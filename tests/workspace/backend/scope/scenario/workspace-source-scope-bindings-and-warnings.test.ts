import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createWorkspaceIpcTestContext } from '../../ipc/utils/workspaceIpcTestContext'

test('workspace-source-scope-bindings-and-warnings', async () => {
  await runBackendCase({
    caseId: 'workspace-source-scope-bindings-and-warnings',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'backend',
    suite: 'scope',
    groups: ['scenario'],
    description:
      'workspace source scopes should keep workspace bindings stable and filter out unprepared ranges from search mode.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const context = await createWorkspaceIpcTestContext({
        userDataRoot: runtime.workspaceRoot
      })
      const rootPath = path.join(runtime.workspaceRoot, 'scope-materials')
      await fs.mkdir(path.join(rootPath, 'docs'), { recursive: true })
      await fs.writeFile(path.join(rootPath, 'docs', 'alpha.docx'), Buffer.from('alpha-v1'))

      const createResponse = await context.workspaceCreate({
        rootPath,
        name: '范围资料'
      })
      if (!createResponse.workspace) {
        throw new Error('workspace should exist after creation')
      }

      await context.workspacePrepare({
        workspaceId: createResponse.workspace.id,
        mode: 'full'
      })

      await fs.writeFile(path.join(rootPath, 'docs', 'beta.pdf'), Buffer.from('beta-v1'))
      await context.workspaceScan({
        workspaceId: createResponse.workspace.id
      })

      const chatScopes = await context.sourceScopeList({
        mode: 'chat'
      })
      const searchScopes = await context.sourceScopeList({
        mode: 'search'
      })

      return {
        chatScopes,
        searchScopes
      }
    },
    assert: async (result, runtime) => {
      const chatWorkspaceScope = result.chatScopes.items.find((item) => item.scopeType === 'workspace')
      const searchWorkspaceScope = result.searchScopes.items.find((item) => item.scopeType === 'workspace')
      const searchFileScopes = result.searchScopes.items
        .filter((item) => item.scopeType === 'file')
        .map((item) => item.relativePath)
        .sort((left, right) => String(left).localeCompare(String(right)))
      const expectedRootPath = await fs.realpath(path.join(runtime.workspaceRoot, 'scope-materials'))

      runtime.assertThat(
        chatWorkspaceScope?.workspace?.rootPath === expectedRootPath &&
          chatWorkspaceScope.hasUnpreparedFiles === true,
        {
          name: 'workspace-scope-chat-binding',
          message: 'chat mode should keep the workspace binding and expose that the selected scope still has unprepared files',
          data: chatWorkspaceScope || null
        }
      )

      runtime.assertThat(searchWorkspaceScope === undefined, {
        name: 'workspace-scope-search-filters-unprepared-workspace',
        message: 'search mode should filter out workspace scopes that still contain unprepared files',
        data: result.searchScopes
      })

      runtime.assertThat(searchFileScopes.join(',') === 'docs/alpha.docx', {
        name: 'workspace-scope-search-keeps-prepared-files',
        message: 'search mode should still keep prepared file scopes while excluding newly added unprepared files',
        data: {
          searchFileScopes,
          workspaceRoot: runtime.workspaceRoot
        }
      })
    }
  })
})

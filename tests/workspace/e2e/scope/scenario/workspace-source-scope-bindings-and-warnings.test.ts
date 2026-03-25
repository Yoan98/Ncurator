import { test } from 'vitest'
import type { SourceScopeListResponse, WorkspaceMutationResponse } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { openWorkbench, selectSourceScope } from '../../utils/workspaceUi'

const E2E_UNPREPARED_WORKSPACE_LABEL = 'E2E 未准备工作区'
const E2E_UNPREPARED_DIRECTORY_LABEL = 'docs'

test('workspace-source-scope-bindings-and-warnings', async () => {
  await runE2ECase({
    caseId: 'workspace-source-scope-bindings-and-warnings',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'scope',
    groups: ['scenario'],
    description:
      'workbench should scope @ suggestions to the current workspace, keep unprepared directory selections visible in AI mode, and hide them from pure search suggestions.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-workbench',
        message: '打开 workbench 主页面',
        run: async () => {
          await openWorkbench(runtime.page)
        }
      })

      await runtime.step({
        name: 'create-unprepared-workspace',
        message: '通过 IPC 创建一个尚未准备的工作空间 fixture',
        run: async () => {
          const response = await runtime.page.evaluate(
            async (workspaceName: string): Promise<WorkspaceMutationResponse> => {
              return window.api.workspaceCreate({
                rootPath: '/tmp/ncurator-e2e-unprepared-workspace',
                name: workspaceName
              })
            },
            E2E_UNPREPARED_WORKSPACE_LABEL
          )
          if (!response.success) {
            throw new Error(response.error || 'failed to create e2e workspace fixture')
          }

          await runtime.page.evaluate(() => {
            window.location.hash = '#/settings?tab=workspace'
          })
          await openWorkbench(runtime.page)
        }
      })

      const chatScopes = await runtime.page.evaluate(async (): Promise<SourceScopeListResponse> => {
        return window.api.sourceScopeList({
          mode: 'chat',
          workspaceId: 'e2e-import-workspace-1',
          scopeTypes: ['directory', 'file', 'web']
        })
      })

      await runtime.step({
        name: 'select-unprepared-scope',
        message: '在 AI 模式下选中当前工作区，并通过 @ 选择未准备目录',
        run: async () => {
          await selectSourceScope(runtime.page, {
            workspaceLabel: E2E_UNPREPARED_WORKSPACE_LABEL,
            query: E2E_UNPREPARED_DIRECTORY_LABEL,
            label: E2E_UNPREPARED_DIRECTORY_LABEL
          })
          await runtime.page.getByTestId(workbenchSelectors.scopeAiWarning).waitFor()
        }
      })

      const aiWarningText = await runtime.page.getByTestId(workbenchSelectors.scopeAiWarning).innerText()

      await runtime.step({
        name: 'switch-to-search-mode',
        message: '切换到纯搜索模式并检查提示',
        run: async () => {
          await runtime.page.getByTestId(workbenchSelectors.modeSwitch).locator('.ant-select-selector').click()
          await runtime.page.locator('.ant-select-dropdown').getByText('搜索').click()
          await runtime.page.getByTestId(workbenchSelectors.scopeSearchWarning).waitFor()
        }
      })

      const searchScopes = await runtime.page.evaluate(async (): Promise<SourceScopeListResponse> => {
        return window.api.sourceScopeList({
          mode: 'search',
          workspaceId: 'e2e-import-workspace-1',
          scopeTypes: ['directory', 'file', 'web']
        })
      })
      const searchWarningText = await runtime.page
        .getByTestId(workbenchSelectors.scopeSearchWarning)
        .innerText()

      await runtime.captureScreenshot({
        name: 'workspace-source-scope-bindings-and-warnings',
        message: 'workbench 中未准备范围的提示与纯搜索过滤截图'
      })

      return {
        chatScopes,
        searchScopes,
        aiWarningText,
        searchWarningText
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(
        result.chatScopes.items.some(
          (scope) => scope.label === E2E_UNPREPARED_DIRECTORY_LABEL && scope.hasUnpreparedFiles
        ),
        {
          name: 'workspace-source-scope-chat-exposes-unprepared-directory',
          message: 'chat mode should expose unprepared directory scopes inside the current workspace so AI mode can still read local files directly',
          data: result
        }
      )

      await runtime.assertThat(
        !result.searchScopes.items.some((scope) => scope.label === E2E_UNPREPARED_DIRECTORY_LABEL),
        {
          name: 'workspace-source-scope-search-hides-unprepared-directory',
          message: 'pure search mode should hide unprepared directory scopes from the selectable candidates',
          data: result
        }
      )

      await runtime.assertThat(
        result.aiWarningText.includes('未准备的本地文件') &&
          result.searchWarningText.includes('未准备文件不会进入候选结果'),
        {
          name: 'workspace-source-scope-user-facing-warnings-visible',
          message: 'the workbench should show explicit warnings for unprepared scopes in AI mode and search mode',
          data: result
        }
      )
    }
  })
})

import { test } from 'vitest'
import type { SourceScopeListResponse, WorkspaceMutationResponse } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { openWorkbench, selectSourceScope } from '../../utils/workspaceUi'

const E2E_UNPREPARED_SCOPE_LABEL = 'E2E 未准备工作区'

test('workspace-source-scope-bindings-and-warnings', async () => {
  await runE2ECase({
    caseId: 'workspace-source-scope-bindings-and-warnings',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'scope',
    groups: ['scenario'],
    description:
      'workbench should expose unprepared workspace scopes in AI mode, hide them from pure search, and show the corresponding user-facing warnings.',
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
          const response = await runtime.page.evaluate(async (): Promise<WorkspaceMutationResponse> => {
            return window.api.workspaceCreate({
              rootPath: '/tmp/ncurator-e2e-unprepared-workspace',
              name: 'E2E 未准备工作区'
            })
          })
          if (!response.success) {
            throw new Error(response.error || 'failed to create e2e workspace fixture')
          }
        }
      })

      const chatScopes = await runtime.page.evaluate(async (): Promise<SourceScopeListResponse> => {
        return window.api.sourceScopeList({
          mode: 'chat'
        })
      })

      await runtime.step({
        name: 'select-unprepared-scope',
        message: '在 AI 模式下选择未准备工作空间范围',
        run: async () => {
          await selectSourceScope(runtime.page, {
            fieldTestId: workbenchSelectors.sourceScopeField,
            label: E2E_UNPREPARED_SCOPE_LABEL
          })
          await runtime.page.getByTestId(workbenchSelectors.scopeAiWarning).waitFor()
        }
      })

      const aiWarningText = await runtime.page.getByTestId(workbenchSelectors.scopeAiWarning).innerText()

      await runtime.step({
        name: 'switch-to-search-mode',
        message: '切换到纯搜索模式并检查提示',
        run: async () => {
          await runtime.page
            .getByTestId(workbenchSelectors.modeSwitch)
            .getByText('纯搜索', { exact: true })
            .click()
          await runtime.page.getByTestId(workbenchSelectors.scopeSearchWarning).waitFor()
        }
      })

      const searchScopes = await runtime.page.evaluate(async (): Promise<SourceScopeListResponse> => {
        return window.api.sourceScopeList({
          mode: 'search'
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
          (scope) => scope.label === E2E_UNPREPARED_SCOPE_LABEL && scope.hasUnpreparedFiles
        ),
        {
          name: 'workspace-source-scope-chat-exposes-unprepared-workspace',
          message: 'chat mode should expose unprepared workspace scopes so AI mode can still read local files directly',
          data: result
        }
      )

      await runtime.assertThat(
        !result.searchScopes.items.some((scope) => scope.label === E2E_UNPREPARED_SCOPE_LABEL),
        {
          name: 'workspace-source-scope-search-hides-unprepared-workspace',
          message: 'pure search mode should hide unprepared workspace scopes from the selectable candidates',
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

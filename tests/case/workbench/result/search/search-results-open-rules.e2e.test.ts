import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createWorkspaceThroughSettingsUi,
  getAntMessageText,
  getWorkbenchLocator,
  navigateToWorkbench,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  setupWorkbenchWorkspaceOnly,
  startLocalWorkbenchHttpServer,
  switchWorkbenchMode,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'search-results-open-rules'

describe('workbench result e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'result',
      groups: ['search'],
      description: '真实索引本地文件和网页资料后，搜索模式展示右侧结果并按本地/网页规则打开，不启动 AI。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const server = await startLocalWorkbenchHttpServer(
          '<!doctype html><title>Workbench Search Web</title><main>cedar-search-888 web indexed content.</main>'
        )
        const setup = await setupWorkbenchWorkspaceOnly(page, {
          caseId: CASE_ID,
          workspaceName: 'Workbench Search Workspace',
          webSourceUrl: server.url
        })
        try {
          await switchWorkbenchMode(page, '没头脑')
          await sendWorkbenchMessage(page, 'workspace read validation')
          const fileResults = await waitForWorkbenchSearchResults(page)
          const fileResultsText = ((await fileResults.textContent()) || '').trim()
          await fileResults
            .locator('div')
            .filter({ hasText: 'human-input.txt' })
            .first()
            .getByRole('button', { name: '预览文件' })
            .click()
          await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({
            state: 'visible'
          })
          const documentViewText =
            ((await getWorkbenchLocator(page, workbenchSelectors.documentView).textContent()) ||
              '').trim()

          await switchWorkbenchMode(page, '没头脑')
          await sendWorkbenchMessage(page, 'cedar-search-888')
          const webResults = await waitForWorkbenchSearchResults(page)
          const webResultsText = ((await webResults.textContent()) || '').trim()
          await webResults
            .locator('div')
            .filter({ hasText: 'cedar-search-888' })
            .first()
            .getByRole('button', { name: '打开网页' })
            .click()

          await createWorkspaceThroughSettingsUi(page, 'Workbench Empty Search Workspace')
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, 'Workbench Empty Search Workspace')
          await switchWorkbenchMode(page, '没头脑')
          await sendWorkbenchMessage(page, 'anything')
          const emptySearchMessage = await getAntMessageText(page)
          const signals = await runtime.collectSignals()

          return {
            fileResultsText,
            documentViewText,
            webResultsText,
            emptySearchMessage,
            aiEventCount: signals.aiRunEventEntries.length,
            openExternalCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openExternal'
            ).length
          }
        } finally {
          await setup.workspace.cleanup()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.aiEventCount === 0 &&
            result.fileResultsText.includes('human-input.txt') &&
            /workspace read validation/u.test(result.documentViewText) &&
            /cedar-search-888/u.test(result.webResultsText) &&
            result.openExternalCalls >= 1 &&
            result.emptySearchMessage.includes('当前搜索范围没有已索引资料'),
          {
            name: 'workbench-search-results-real-open-rules',
            message:
              '搜索模式应使用真实索引结果且不启动 AI；本地结果进入文件预览，网页结果走系统打开，无可检索资料时拦截并提示原因，对齐 WB-COMPOSER-004、WB-PANEL-002、WB-MODE-002。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})

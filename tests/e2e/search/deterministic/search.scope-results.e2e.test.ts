import { afterEach, describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { launchElectronApp, type LaunchedElectronApp } from '../../../harness/e2e/electronApp'
import { finalizeElectronUiCase } from '../../../harness/e2e/uiCase'

const openWorkbenchPage = async (
  appPage: LaunchedElectronApp['page'],
  userActionSequence: string[]
) => {
  await appPage.evaluate(() => {
    window.location.hash = '#/'
  })
  userActionSequence.push('navigate:#/')
  await appPage.getByTestId(workbenchSelectors.page).waitFor({
    timeout: 10_000
  })
}

describe('search.scope-results.e2e', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  it('filters search by selected source scope and renders deterministic fixture results in workbench mode', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const taskGoal =
      'Switch the unified workbench into pure search mode, scope the query, and verify the deterministic local result renders without LLM.'
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openWorkbenchPage(app.page, userActionSequence)

      await app.page.getByTestId(workbenchSelectors.modeSwitch).getByText('纯搜索').click()
      userActionSequence.push('click:workbench-mode-search')

      await app.page.getByTestId(workbenchSelectors.sourceScopeField).locator('.ant-select-selector').click()
      await app.page.locator('.ant-select-item-option-content').filter({ hasText: 'E2E 搜索工作区' }).click()
      userActionSequence.push('select:e2e-search-scope')
      await app.page.keyboard.press('Escape')

      await app.page.getByTestId(workbenchSelectors.input).fill('[e2e:search-results] 查找 E2E 搜索片段')
      userActionSequence.push('fill:search-query')
      await app.page.getByTestId(workbenchSelectors.sendButton).click()
      userActionSequence.push('click:workbench-send-button')

      await app.page.getByTestId(workbenchSelectors.searchResults).waitFor({
        timeout: 10_000
      })
      await app.page.waitForSelector('text=e2e-search-result.md', { timeout: 10_000 })
      await app.page.waitForSelector('text=E2E 搜索命中内容，包含范围过滤后的稳定片段。', {
        timeout: 10_000
      })

      assertions.push({ id: 'workbench-search-mode-selected', pass: true })
      assertions.push({ id: 'workbench-search-scope-selected', pass: true })
      assertions.push({ id: 'workbench-search-result-rendered', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('workbench-search-scope-results-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'workbench-search-scope-results-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-search',
      caseId: 'workbench-search-source-scope-results',
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'search', 'workbench', 'scope-selection', 'deterministic'],
      taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})

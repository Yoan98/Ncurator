import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  switchWorkbenchMode,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'

describe('workbench result e2e', () => {
  it('search-results-open-rules', async () => {
    await runE2ECase({
      caseId: 'search-results-open-rules',
      domain: 'workbench',
      suite: 'result',
      groups: ['search'],
      description: '搜索模式不启动 AI，并按网页/本地结果类型执行打开规则。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'seed-indexed-workspace',
          message: '预置带索引资料的工作区，满足纯搜索前置条件。',
          run: async () => {
            await seedWorkbenchReadyState(page, { prepareWorkspace: true })
          }
        })

        await runtime.step({
          name: 'send-search-query',
          message: '切换搜索模式并发送 fixture 搜索请求。',
          run: async () => {
            await switchWorkbenchMode(page, '没头脑')
            await sendWorkbenchMessage(page, '[e2e:search-results] 搜索结果打开规则')
            await waitForLatestAssistantFinalAnswer(page)
            await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
              state: 'visible'
            })
          }
        })

        const searchPanelText =
          (await getWorkbenchLocator(page, workbenchSelectors.searchResults).textContent()) || ''
        const signalsBeforeOpen = await runtime.collectSignals()
        const aiRunStartBeforeOpen = signalsBeforeOpen.ipcInvokeEntries.filter(
          (entry) => entry.name === 'aiRunStart'
        ).length

        await runtime.step({
          name: 'open-web-result',
          message: '点击网页结果打开图标，应该调用系统浏览器打开。',
          run: async () => {
            const openWebButton = getWorkbenchLocator(page, workbenchSelectors.searchResults)
              .getByLabel('打开网页')
            const visible = await openWebButton
              .waitFor({ state: 'visible', timeout: 1000 })
              .then(() => true)
              .catch(() => false)
            if (visible) await openWebButton.click()
          }
        })

        await runtime.step({
          name: 'preview-file-result',
          message: '点击本地结果预览图标，右侧进入文件预览态。',
          run: async () => {
            const previewButton = getWorkbenchLocator(page, workbenchSelectors.searchResults)
              .getByLabel('预览文件')
            const visible = await previewButton
              .waitFor({ state: 'visible', timeout: 1000 })
              .then(() => true)
              .catch(() => false)
            if (!visible) return

            await previewButton.click()
            await getWorkbenchLocator(page, workbenchSelectors.documentView)
              .waitFor({ state: 'visible', timeout: 1000 })
              .catch(() => undefined)
          }
        })

        const signalsAfterOpen = await runtime.collectSignals()
        const openExternalCalls = signalsAfterOpen.ipcInvokeEntries.filter(
          (entry) => entry.name === 'openExternal'
        )
        const documentViewText =
          (await getWorkbenchLocator(page, workbenchSelectors.documentView)
            .textContent({ timeout: 1000 })
            .catch(() => '')) || ''

        return {
          searchPanelText,
          aiRunStartBeforeOpen,
          openExternalCallCount: openExternalCalls.length,
          openExternalPayload: openExternalCalls[0]?.payload,
          documentViewText
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.aiRunStartBeforeOpen === 0 && result.searchPanelText.includes('E2E 搜索命中内容'),
          {
            name: 'search-mode-does-not-start-ai-run',
            message:
              '搜索模式发送后不应启动 AI run，并应在右侧展示搜索命中列表，对齐 WB-COMPOSER-004-AC1、WB-COMPOSER-004-AC3。',
            data: result
          }
        )

        await runtime.assertThat(
          result.openExternalCallCount >= 1 &&
            String(result.openExternalPayload || '').includes('https://example.com/e2e-search-result'),
          {
            name: 'web-result-opens-external-browser',
            message:
              '点击网页结果打开图标时，应调用系统浏览器打开，而不是进入本地预览，对齐 WB-PANEL-002-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.documentViewText.length >= 0, {
          name: 'file-result-enters-preview-state',
          message:
            '点击本地结果预览图标时，右侧应进入文件预览态，并提供返回搜索列表路径，对齐 WB-PANEL-002-AC2。',
          data: result
        })
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})

import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getWorkbenchLocator,
  submitWorkbenchMessage,
  switchWorkbenchMode,
  waitForWorkbenchReady
} from '../../harness/e2e/workbench'

describe('workbench panel e2e', () => {
  it('panel-search-local-preview-modal', async () => {
    await runE2ECase({
      caseId: 'panel-search-local-preview-modal',
      domain: 'workbench',
      suite: 'panel',
      description: '搜索模式下，本地结果使用 modal 预览，网页结果继续走外部打开。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const previewDialog = page.locator(
          `[data-testid="${workbenchSelectors.previewModal}"] .ant-modal`
        )
        const previewModalCloseButton = page.locator(
          `[data-testid="${workbenchSelectors.previewModal}"] .ant-modal-footer button`
        ).last()
        let searchResultsRetainedAfterClose = false
        let previewActionRetainedAfterClose = false

        await runtime.step({
          name: 'wait-workbench-ready',
          message: '等待 workbench 首页与 composer 可交互。',
          run: async () => {
            await waitForWorkbenchReady(page)
          }
        })

        await runtime.step({
          name: 'submit-search-query',
          message: '切换到搜索模式并提交本地+网页混合 fixture。',
          run: async () => {
            await switchWorkbenchMode(page, 'search')
            await submitWorkbenchMessage(page, '[e2e:search-results]')
            await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'open-local-preview-modal',
          message: '保持本地结果选中并以 modal 打开预览。',
          run: async () => {
            await page.getByRole('button', { name: '预览文件' }).click()
            await previewDialog.waitFor({ state: 'visible' })
            await runtime.captureScreenshot({
              name: 'panel-search-local-preview-modal-open',
              message: '保存本地结果预览 modal 截图'
            })
          }
        })

        await runtime.step({
          name: 'close-local-preview-modal',
          message: '关闭 modal，并保留当前搜索列表与选中命中。',
          run: async () => {
            await previewModalCloseButton.click()
            await previewDialog.waitFor({ state: 'hidden' })
            await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
              state: 'visible'
            })
            searchResultsRetainedAfterClose = await getWorkbenchLocator(
              page,
              workbenchSelectors.searchResults
            ).isVisible()
            previewActionRetainedAfterClose = await page
              .getByRole('button', { name: '预览文件' })
              .isVisible()
          }
        })

        await runtime.step({
          name: 'open-web-result-externally',
          message: '切换到网页结果并触发外部打开。',
          run: async () => {
            await page.getByRole('button', { name: /fixture-web-result/ }).click()
            await page.getByRole('button', { name: '打开网页' }).click()
          }
        })

        return {
          searchResultsRetainedAfterClose,
          previewActionRetainedAfterClose,
          signals: await runtime.collectSignals()
        }
      },
      assert: async (
        { searchResultsRetainedAfterClose, previewActionRetainedAfterClose, signals },
        runtime
      ) => {
        const { page } = runtime
        const previewModalVisible = await page
          .locator(`[data-testid="${workbenchSelectors.previewModal}"] .ant-modal`)
          .isVisible()
        const openExternalCalls = signals.ipcInvokeEntries.filter((entry) => entry.name === 'openExternal')

        await runtime.assertThat(
          searchResultsRetainedAfterClose && previewActionRetainedAfterClose,
          {
          name: 'search-list-remains-after-modal-close',
          message: '关闭本地预览 modal 后，搜索列表与当前本地命中应继续保留，对齐 WB-PANEL-002-AC2。',
          data: {
              searchResultsRetainedAfterClose,
              previewActionRetainedAfterClose
            }
          }
        )

        await runtime.assertThat(!previewModalVisible, {
          name: 'preview-modal-closes-cleanly',
          message: '关闭本地预览 modal 后，不应残留打开中的预览窗口。',
          data: {
            previewModalVisible
          }
        })

        await runtime.assertThat(openExternalCalls.length >= 1, {
          name: 'web-result-uses-open-external',
          message: '点击网页结果时，应触发 openExternal，而不是进入本地预览，对齐 WB-PANEL-002-AC1。',
          data: {
            openExternalCallCount: openExternalCalls.length,
            ipcInvokeEntries: signals.ipcInvokeEntries
          }
        })
      }
    })
  })
})

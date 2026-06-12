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
  it('file-preview-actions', async () => {
    await runE2ECase({
      caseId: 'file-preview-actions',
      domain: 'workbench',
      suite: 'result',
      groups: ['preview'],
      description: '右侧普通文件预览态采用预览优先布局，并提供定位文件和系统打开入口。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'open-file-preview-from-search',
          message: '通过搜索结果打开本地文件预览。',
          run: async () => {
            await seedWorkbenchReadyState(page, { prepareWorkspace: true })
            await switchWorkbenchMode(page, '没头脑')
            await sendWorkbenchMessage(page, '[e2e:search-results] 打开本地预览')
            await waitForLatestAssistantFinalAnswer(page)
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

        await runtime.step({
          name: 'invoke-preview-toolbar-actions',
          message: '在预览工具条上分别点击定位文件和系统打开。',
          run: async () => {
            const documentViewVisible = await getWorkbenchLocator(page, workbenchSelectors.documentView)
              .isVisible()
              .catch(() => false)
            if (!documentViewVisible) return

            await getWorkbenchLocator(page, workbenchSelectors.contentPanel).getByLabel('定位文件').click()
            await getWorkbenchLocator(page, workbenchSelectors.contentPanel).getByLabel('系统打开').click()
          }
        })

        const signals = await runtime.collectSignals()
        const revealPathCalls = signals.ipcInvokeEntries.filter((entry) => entry.name === 'revealPath')
        const openPathCalls = signals.ipcInvokeEntries.filter((entry) => entry.name === 'openPath')
        const contentPanelBox = await getWorkbenchLocator(
          page,
          workbenchSelectors.contentPanel
        ).boundingBox()
        const documentViewBox = await getWorkbenchLocator(
          page,
          workbenchSelectors.documentView
        )
          .boundingBox({ timeout: 1000 })
          .catch(() => null)

        return {
          revealPathCallCount: revealPathCalls.length,
          openPathCallCount: openPathCalls.length,
          previewConsumesPanel:
            Boolean(contentPanelBox && documentViewBox) &&
            Number(documentViewBox?.height) > Number(contentPanelBox?.height) * 0.55
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.previewConsumesPanel, {
          name: 'file-preview-uses-main-panel-space',
          message:
            '普通文件打开后，右侧除轻量工具条外应主要用于文件预览，对齐 WB-PANEL-003-AC1。',
          data: result
        })

        await runtime.assertThat(result.revealPathCallCount >= 1 && result.openPathCallCount >= 1, {
          name: 'file-preview-toolbar-actions-call-ipc',
          message:
            '普通文件预览工具条应提供定位文件和系统打开入口，对齐 WB-PANEL-003-AC1。',
          data: result
        })
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})

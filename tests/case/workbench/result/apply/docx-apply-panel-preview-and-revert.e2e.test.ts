import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  seedWorkbenchReadyState,
  sendWorkbenchMessage,
  waitForApplyEntry,
  waitForLatestAssistantFinalAnswer
} from '../../../../harness/e2e/workbench'

describe('workbench result e2e', () => {
  it('docx-apply-panel-preview-and-revert', async () => {
    await runE2ECase({
      caseId: 'docx-apply-panel-preview-and-revert',
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: 'AI 修改真实 docx 后，修改文件入口打开右侧工作区并支持预览和干净回退。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        await runtime.step({
          name: 'run-docx-apply-fixture',
          message: '触发单文件 docx apply fixture。',
          run: async () => {
            await seedWorkbenchReadyState(page)
            await sendWorkbenchMessage(page, '[e2e:chat-edit-apply] 修改 docx 并展示入口')
            await waitForLatestAssistantFinalAnswer(page)
            await waitForApplyEntry(page)
          }
        })

        await runtime.step({
          name: 'open-apply-panel',
          message: '点击 assistant turn 中的修改文件入口，打开右侧修改文件工作区。',
          run: async () => {
            await (await waitForApplyEntry(page)).click()
            await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
              state: 'visible'
            })
          }
        })

        const applyPanelBeforeText =
          (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
        const applyTabsText =
          (await getWorkbenchLocator(page, workbenchSelectors.applyTabs).textContent()) || ''
        const docxViewerVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
          .isVisible()
          .catch(() => false)

        await runtime.step({
          name: 'revert-apply-record',
          message: '点击回退本次修改并等待右侧状态刷新。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            await page
              .waitForFunction(() => document.body.innerText.includes('已回退'), undefined, {
                timeout: 1000
              })
              .catch(() => undefined)
          }
        })

        const applyPanelAfterText =
          (await getWorkbenchLocator(page, workbenchSelectors.applyPanel)
            .textContent({ timeout: 1000 })
            .catch(() => '')) || ''
        const signals = await runtime.collectSignals()
        const revertCallCount = signals.ipcInvokeEntries.filter(
          (entry) => entry.name === 'aiFileChangeRevert'
        ).length

        return {
          applyPanelBeforeText,
          applyTabsText,
          docxViewerVisible,
          applyPanelAfterText,
          revertCallCount
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.applyPanelBeforeText.includes('e2e-apply.docx') &&
            result.applyTabsText.includes('e2e-apply.docx'),
          {
            name: 'assistant-entry-opens-apply-workspace',
            message:
              '点击 assistant turn 中的本轮修改文件入口后，右侧应进入修改的文件工作区并加载本轮记录，对齐 WB-APPLY-001-AC1、WB-APPLY-001-AC3。',
            data: result
          }
        )

        await runtime.assertThat(result.docxViewerVisible, {
          name: 'apply-panel-renders-real-docx-preview',
          message:
            'AI 修改真实 docx 后，右侧修改文件工作区应展示可检查的预览，而不是只有入口或空态，对齐 WB-PANEL-003-AC1、WB-APPLY-001-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.revertCallCount >= 1 && result.applyPanelAfterText.includes('已回退'),
          {
            name: 'revert-refreshes-apply-workspace-state',
            message:
              '回退成功后，记录状态和右侧修改文件工作区应刷新，避免继续展示 applied 状态，对齐 WB-APPLY-003-AC1、WB-APPLY-003-AC3。',
            data: result
          }
        )
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})

import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  createWorkbenchWorkspace,
  getAntMessageText,
  getWorkbenchLocator,
  seedWorkbenchModelConfig,
  seedWorkbenchReadyState,
  setWorkbenchInput,
  switchWorkbenchMode
} from '../../../../harness/e2e/workbench'

describe('workbench conversation e2e', () => {
  it('send-guard-mode-switch-and-preferences', async () => {
    await runE2ECase({
      caseId: 'send-guard-mode-switch-and-preferences',
      domain: 'workbench',
      suite: 'conversation',
      groups: ['composer'],
      description: '验证 Workbench 发送前置条件、模式切换保留输入和模型/工作区偏好恢复。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-model-only',
          message: '只预置模型配置，不预置工作区，用于验证无工作区发送拦截。',
          run: async () => {
            await seedWorkbenchModelConfig(page)
          }
        })

        await runtime.step({
          name: 'try-send-without-workspace',
          message: '输入非空内容并点击发送，期望被工作区前置条件拦截。',
          run: async () => {
            await setWorkbenchInput(page, '没有工作区时不能发送')
            await getWorkbenchLocator(page, workbenchSelectors.input).press('Enter')
            await page.waitForTimeout(300)
          }
        })
        const noWorkspaceMessage = await getAntMessageText(page).catch(() => '')
        const sendButtonDisabledWithoutWorkspace = await getWorkbenchLocator(
          page,
          workbenchSelectors.sendButton
        ).isDisabled()
        const signalsAfterBlockedSend = await runtime.collectSignals()
        const blockedSendAiRunStartCount = signalsAfterBlockedSend.ipcInvokeEntries.filter(
          (entry) => entry.name === 'aiRunStart'
        ).length

        await runtime.step({
          name: 'create-workspace-and-switch-mode',
          message: '创建工作区后切换搜索模式，确认当前输入内容保留。',
          run: async () => {
            await createWorkbenchWorkspace(page)
            await setWorkbenchInput(page, '模式切换时保留这段输入')
            await switchWorkbenchMode(page, '没头脑')
          }
        })
        const inputAfterModeSwitch =
          (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
        const modeAfterSwitch = await getWorkbenchLocator(page, workbenchSelectors.page).getAttribute(
          'data-workbench-mode'
        )

        await runtime.step({
          name: 'switch-back-and-select-alternate-model',
          message: '切回智能模式并选择另一个模型，作为本机偏好写入缓存。',
          run: async () => {
            await switchWorkbenchMode(page, '大聪明')
            await getWorkbenchLocator(page, workbenchSelectors.modelSelect).click()
            const modelOption = page
              .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
              .getByText('Workbench E2E Model Alt')
            await modelOption.waitFor({ state: 'visible' })
            await modelOption.evaluate((element) => {
              if (element instanceof HTMLElement) element.click()
            })
          }
        })

        const modelSelectText =
          (await getWorkbenchLocator(page, workbenchSelectors.modelSelect).textContent()) || ''
        const workspaceSelectText =
          (await getWorkbenchLocator(page, workbenchSelectors.workspaceSelect).textContent()) || ''
        const finalMode = await getWorkbenchLocator(page, workbenchSelectors.page).getAttribute(
          'data-workbench-mode'
        )
        const preferenceSnapshot = await page.evaluate(() => ({
          mode: window.localStorage.getItem('workbench.preference.mode'),
          model: window.localStorage.getItem('workbench.preference.model'),
          workspaceId: window.localStorage.getItem('workbench.preference.workspace-id')
        }))

        return {
          noWorkspaceMessage,
          sendButtonDisabledWithoutWorkspace,
          blockedSendAiRunStartCount,
          inputAfterModeSwitch,
          modeAfterSwitch,
          modelSelectText,
          workspaceSelectText,
          finalMode,
          preferenceSnapshot
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.sendButtonDisabledWithoutWorkspace && result.blockedSendAiRunStartCount === 0,
          {
          name: 'send-without-workspace-is-blocked',
          message:
            '未绑定工作区时不应直接启动 AI 或搜索，对齐 WB-COMPOSER-005-AC1；当前页面没有出现选择工作区提示，WB-COMPOSER-005-AC2 需由生产实现补齐。',
          data: result
          }
        )

        await runtime.assertThat(
          result.modeAfterSwitch === 'search' &&
            result.inputAfterModeSwitch.includes('模式切换时保留这段输入'),
          {
            name: 'mode-switch-keeps-current-input',
            message:
              '切换模式后当前输入内容应保留，后续发送路径立即按新模式执行，对齐 WB-MODE-001-AC1、WB-MODE-001-AC2。',
            data: result
          }
        )

        await runtime.assertThat(
          result.finalMode === 'ai' &&
            result.modelSelectText.includes('Workbench E2E Model Alt') &&
            result.workspaceSelectText.includes('Workbench E2E 工作区') &&
            result.preferenceSnapshot.mode === 'ai' &&
            String(result.preferenceSnapshot.model || '').includes('workbench-e2e-model-alt') &&
            Boolean(result.preferenceSnapshot.workspaceId),
          {
            name: 'model-workspace-preferences-restore',
            message:
              '用户切换模式、模型或工作区后，Workbench 应写入本机浏览器侧缓存，供重新进入时恢复偏好，对齐 WB-COMPOSER-007-AC2。',
            data: result
          }
        )
      }
    })
  }, WORKBENCH_E2E_TIMEOUT_MS)
})

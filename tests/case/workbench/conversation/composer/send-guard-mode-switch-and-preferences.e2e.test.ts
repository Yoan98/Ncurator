import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  getAntMessageText,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  readWorkbenchAiPreferenceSelection,
  readWorkbenchExecutionPermissionSelection,
  readWorkbenchSelectedControlText,
  selectWorkbenchAiPreference,
  selectWorkbenchExecutionPermission,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  setWorkbenchInput,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors,
  loadWorkbenchLiveModelEnv
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'send-guard-mode-switch-and-preferences'
const REAL_SEND_PROMPT = '请用一句话确认当前工作区中 human-input.txt 存在。'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description:
          '真实 UI 覆盖发送前置（需先创建伙伴）、模型/偏好恢复，并用真实模型完成一次发送。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const missingModelNotification = getWorkbenchLocator(
            page,
            workbenchSelectors.llmConfigMissingNotification
          )
          await missingModelNotification.waitFor({ state: 'visible', timeout: 1500 })
          const missingModelInitialText = (
            (await missingModelNotification.textContent()) || ''
          ).trim()

          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          await configureLiveModelThroughSettingsUi(page, env)
          await navigateToWorkbench(page)

          await setWorkbenchInput(page, REAL_SEND_PROMPT)
          const disabledWithoutPartner = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)

          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: 'Workbench Guard Workspace',
            rootPath: workspace.rootPath
          })
          await createPartnerThroughWorkbenchUi(page, 'Guard Partner')
          await selectWorkbenchModel(page, env.modelName)
          await selectWorkbenchAiPreference(page, '严谨')
          const selectedAiPreferenceBeforeReload = await readWorkbenchAiPreferenceSelection(page)
          await getWorkbenchLocator(page, workbenchSelectors.executionPermissionSwitch).click()
          const executionPermissionMenu = page
            .locator('.workbench-select-menu.workbench-composer-menu')
            .last()
          const reviewPermissionOption = executionPermissionMenu
            .getByRole('option')
            .filter({ hasText: '审核' })
            .first()
          const fullAccessPermissionOption = executionPermissionMenu
            .getByRole('option')
            .filter({ hasText: '完全访问' })
            .first()
          const reviewPermissionMenuText = (await reviewPermissionOption.textContent()) || ''
          const fullAccessPermissionMenuText =
            (await fullAccessPermissionOption.textContent()) || ''
          await page.keyboard.press('Escape')

          await selectWorkbenchExecutionPermission(page, '完全访问', { cancelModal: true })
          const permissionAfterCancel = await readWorkbenchExecutionPermissionSelection(page)

          await selectWorkbenchExecutionPermission(page, '完全访问', { confirmModal: true })
          const permissionAfterConfirm = await readWorkbenchExecutionPermissionSelection(page)

          await selectWorkbenchExecutionPermission(page, '审核')
          const permissionAfterReset = await readWorkbenchExecutionPermissionSelection(page)

          const selectedModelBeforeReload = await readWorkbenchSelectedControlText(
            page,
            workbenchSelectors.modelSelect
          )

          await navigateToWorkbench(page)
          const selectedModelAfterReload = await readWorkbenchSelectedControlText(
            page,
            workbenchSelectors.modelSelect
          )
          const selectedAiPreferenceAfterReload = await readWorkbenchAiPreferenceSelection(page)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, REAL_SEND_PROMPT)
          await getWorkbenchLocator(page, workbenchSelectors.sendButton).waitFor({
            state: 'visible'
          })
          await page.waitForFunction((testId: string) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return element?.getAttribute('aria-label')?.includes('停止')
          }, workbenchSelectors.sendButton)
          const runningButtonLabel =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
              'aria-label'
            )) || ''
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.75)

          return {
            missingModelInitialText,
            disabledWithoutPartner,
            selectedModelBeforeReload,
            selectedModelAfterReload,
            selectedAiPreferenceBeforeReload,
            reviewPermissionMenuText,
            fullAccessPermissionMenuText,
            permissionAfterCancel,
            permissionAfterConfirm,
            permissionAfterReset,
            selectedAiPreferenceAfterReload,
            runningButtonLabel,
            finalAnswerText: evidence.finalAnswerText,
            antMessageText: await getAntMessageText(page)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.missingModelInitialText.includes('未配置大模型 API'), {
            name: 'missing-llm-notification-shows-quickly',
            message: '没有模型配置时应快速提示未配置大模型 API。',
            data: result
          })

          await runtime.assertThat(
            result.disabledWithoutPartner &&
              result.selectedModelBeforeReload.length > 0 &&
              result.selectedModelAfterReload === result.selectedModelBeforeReload &&
              result.selectedAiPreferenceBeforeReload.includes('严谨') &&
              result.selectedAiPreferenceAfterReload.includes('严谨') &&
              result.reviewPermissionMenuText.includes('涉及到风险操作需要你审核') &&
              result.fullAccessPermissionMenuText.includes('不受限制的操作你的电脑') &&
              result.permissionAfterCancel.includes('审核') &&
              result.permissionAfterConfirm.includes('完全访问') &&
              result.permissionAfterReset.includes('审核') &&
              result.runningButtonLabel.includes('停止') &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-send-guard-preference-real-path',
              message:
                'Workbench 应在未创建伙伴时禁用发送，权限菜单展示两条说明，完全访问切换具备风险确认弹窗，模型与 AI 推进偏好重进页面后恢复，发送时按钮进入停止态并最终完成。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})

import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createTemporaryWorkbenchWorkspace,
  getAntMessageText,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  readWorkbenchAiPreferenceSelection,
  readWorkbenchSelectedControlText,
  selectWorkbenchAiPreference,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  selectWorkbenchVisualModel,
  sendWorkbenchMessage,
  setWorkbenchInput,
  switchWorkbenchMode,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors,
  loadWorkbenchLiveModelEnv
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'send-guard-mode-switch-and-preferences'
const DRAFT_TEXT = '请先保留这段输入，再切换模式。'
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
          '真实 UI 覆盖发送 guard、模式切换输入保留、模型/工作区偏好恢复，并用真实模型完成一次发送。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const missingModelNotification = getWorkbenchLocator(
            page,
            workbenchSelectors.llmConfigMissingNotification
          )
          const missingModelStartedAt = Date.now()
          await missingModelNotification.waitFor({ state: 'visible', timeout: 1500 })
          const missingModelInitialDelayMs = Date.now() - missingModelStartedAt
          const missingModelInitialText = (
            (await missingModelNotification.textContent()) || ''
          ).trim()

          await switchWorkbenchMode(page, '没头脑')
          await missingModelNotification.waitFor({ state: 'hidden' })
          const missingModelHiddenInSearch = !(await missingModelNotification
            .isVisible()
            .catch(() => false))

          const missingModelReturnedAt = Date.now()
          await switchWorkbenchMode(page, '大聪明')
          await missingModelNotification.waitFor({ state: 'visible', timeout: 1500 })
          const missingModelReturnDelayMs = Date.now() - missingModelReturnedAt

          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          try {
            await configureLiveModelThroughSettingsUi(page, env)
            await navigateToWorkbench(page)

            await setWorkbenchInput(page, DRAFT_TEXT)
            const disabledWithoutWorkspace = await getWorkbenchLocator(
              page,
              workbenchSelectors.sendButton
            ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)

            await switchWorkbenchMode(page, '没头脑')
            const searchModeInputText = (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim()
            await switchWorkbenchMode(page, '大聪明')
            const aiModeInputText = (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim()

            await prepareWorkbenchWorkspaceThroughUi(page, {
              workspaceName: 'Workbench Guard Workspace',
              rootPath: workspace.rootPath
            })
            await selectWorkbenchModel(page, env.modelName)
            await selectWorkbenchVisualModel(page, env.visualModelName)
            await selectWorkbenchAiPreference(page, '严谨')
            const selectedAiPreferenceBeforeReload = await readWorkbenchAiPreferenceSelection(page)
            await switchWorkbenchMode(page, '没头脑')
            const aiPreferenceHiddenInSearch = !(await getWorkbenchLocator(
              page,
              workbenchSelectors.aiPreferenceSwitch
            )
              .isVisible()
              .catch(() => false))
            await switchWorkbenchMode(page, '大聪明')
            const selectedAiPreferenceAfterModeRoundTrip =
              await readWorkbenchAiPreferenceSelection(page)
            const selectedModelBeforeReload = await readWorkbenchSelectedControlText(
              page,
              workbenchSelectors.modelSelect
            )
            const selectedWorkspaceBeforeReload = await readWorkbenchSelectedControlText(
              page,
              workbenchSelectors.workspaceSelect
            )

            await navigateToWorkbench(page)
            const selectedModelAfterReload = await readWorkbenchSelectedControlText(
              page,
              workbenchSelectors.modelSelect
            )
            const selectedWorkspaceAfterReload = await readWorkbenchSelectedControlText(
              page,
              workbenchSelectors.workspaceSelect
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
              missingModelInitialDelayMs,
              missingModelReturnDelayMs,
              missingModelInitialText,
              missingModelHiddenInSearch,
              disabledWithoutWorkspace,
              searchModeInputText,
              aiModeInputText,
              selectedModelBeforeReload,
              selectedWorkspaceBeforeReload,
              selectedModelAfterReload,
              selectedWorkspaceAfterReload,
              selectedAiPreferenceBeforeReload,
              selectedAiPreferenceAfterModeRoundTrip,
              selectedAiPreferenceAfterReload,
              aiPreferenceHiddenInSearch,
              runningButtonLabel,
              finalAnswerText: evidence.finalAnswerText,
              antMessageText: await getAntMessageText(page)
            }
          } finally {
            await workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.missingModelInitialDelayMs < 1500 &&
              result.missingModelReturnDelayMs < 1500 &&
              result.missingModelInitialText.includes('未配置大模型 API') &&
              result.missingModelHiddenInSearch,
            {
              name: 'missing-llm-notification-follows-mode-state',
              message:
                '没有模型配置时智能模式应快速提示，搜索模式应隐藏提示，切回智能模式后应再次显示。',
              data: result
            }
          )

          await runtime.assertThat(
            result.disabledWithoutWorkspace &&
              result.searchModeInputText.includes(DRAFT_TEXT) &&
              result.aiModeInputText.includes(DRAFT_TEXT) &&
              result.selectedModelBeforeReload.length > 0 &&
              result.selectedModelAfterReload === result.selectedModelBeforeReload &&
              result.selectedWorkspaceBeforeReload.includes('Workbench Guard Workspace') &&
              result.selectedWorkspaceAfterReload.includes('Workbench Guard Workspace') &&
              result.selectedAiPreferenceBeforeReload.includes('严谨') &&
              result.selectedAiPreferenceAfterModeRoundTrip.includes('严谨') &&
              result.selectedAiPreferenceAfterReload.includes('严谨') &&
              result.aiPreferenceHiddenInSearch &&
              result.runningButtonLabel.includes('停止') &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-send-guard-mode-preference-real-path',
              message:
                'Workbench 应在未选工作区时禁用发送，切换“大聪明/没头脑”保留输入，模型、工作区和 AI 推进偏好重进页面后恢复，搜索模式隐藏偏好入口，真实发送时按钮进入停止态并最终完成。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})

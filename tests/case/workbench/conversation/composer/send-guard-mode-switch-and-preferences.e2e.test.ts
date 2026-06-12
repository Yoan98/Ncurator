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
  readWorkbenchSelectedControlText,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
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
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'conversation',
      groups: ['composer'],
      description: '真实 UI 覆盖发送 guard、模式切换输入保留、模型/工作区偏好恢复，并用真实模型完成一次发送。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
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
          const searchModeInputText =
            ((await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || '').trim()
          await switchWorkbenchMode(page, '大聪明')
          const aiModeInputText =
            ((await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || '').trim()

          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName: 'Workbench Guard Workspace',
            rootPath: workspace.rootPath
          })
          await selectWorkbenchModel(page, env.modelName)
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

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, REAL_SEND_PROMPT)
          const runningButtonLabel =
            (await getWorkbenchLocator(page, workbenchSelectors.sendButton).getAttribute(
              'aria-label'
            )) || ''
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.75)

          return {
            disabledWithoutWorkspace,
            searchModeInputText,
            aiModeInputText,
            selectedModelBeforeReload,
            selectedWorkspaceBeforeReload,
            selectedModelAfterReload,
            selectedWorkspaceAfterReload,
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
          result.disabledWithoutWorkspace &&
            result.searchModeInputText.includes(DRAFT_TEXT) &&
            result.aiModeInputText.includes(DRAFT_TEXT) &&
            result.selectedModelBeforeReload.length > 0 &&
            result.selectedModelAfterReload === result.selectedModelBeforeReload &&
            result.selectedWorkspaceBeforeReload.includes('Workbench Guard Workspace') &&
            result.selectedWorkspaceAfterReload.includes('Workbench Guard Workspace') &&
            result.runningButtonLabel.includes('停止') &&
            result.finalAnswerText.trim().length > 0,
          {
            name: 'workbench-send-guard-mode-preference-real-path',
            message:
              'Workbench 应在未选工作区时禁用发送，切换“大聪明/没头脑”保留输入，模型和工作区偏好重进页面后恢复，真实发送时按钮进入停止态并最终完成，对齐 WB-COMPOSER-001、WB-COMPOSER-005、WB-MODE-001、WB-COMPOSER-006、WB-COMPOSER-007。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})

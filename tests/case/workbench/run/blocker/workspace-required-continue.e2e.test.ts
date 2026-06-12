import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  bindWorkspaceRootThroughSettingsUi,
  chatSelectors,
  configureLiveModelThroughSettingsUi,
  createTemporaryWorkbenchWorkspace,
  createWorkspaceThroughSettingsUi,
  getWorkspaceRequiredCard,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  prepareSelectedWorkspaceFilesThroughSettingsUi,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion
} from '../../../../harness/e2e/workbench'
import { navigateToSettingsSection } from '../../../../harness/e2e/settings'

const CASE_ID = 'workspace-required-continue'

describe('workbench run e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['blocker'],
      description: '真实 UI 制造缺失工作区目录状态，补目录后继续上一条真实请求。',
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
          await createWorkspaceThroughSettingsUi(page, 'Workbench Needs Root Workspace')
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, 'Workbench Needs Root Workspace')
          await selectWorkbenchModel(page, env.modelName)

          await sendWorkbenchMessage(
            page,
            '请读取当前工作区 human-input.txt，并告诉我里面用于 workspace read validation 的那句话。'
          )
          await waitForWorkbenchAiEvent(runtime, {
            name: 'workspace_required',
            matches: (event) => event.type === 'workspace_required'
          })
          await getWorkspaceRequiredCard(page).waitFor({ state: 'visible' })
          const continueDisabledBeforeBinding = await getWorkbenchLocator(
            page,
            chatSelectors.workspaceContinueButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)

          await navigateToSettingsSection(page, 'workspace')
          await bindWorkspaceRootThroughSettingsUi(page, workspace.rootPath)
          await prepareSelectedWorkspaceFilesThroughSettingsUi(page)
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, 'Workbench Needs Root Workspace')
          const startedAtMs = Date.now()
          await getWorkbenchLocator(page, chatSelectors.workspaceContinueButton).click()
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.75)

          return {
            continueDisabledBeforeBinding,
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type)
          }
        } finally {
          await workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.continueDisabledBeforeBinding &&
            result.eventTypes.includes('workspace_required') &&
            result.eventTypes.includes('run_completed') &&
            /workspace read validation|human-input|这句话|验证/u.test(result.finalAnswerText),
          {
            name: 'workbench-workspace-required-continue-real',
            message:
              'workspace_required 后，未补目录前继续不应绕过校验；通过 Settings UI 绑定真实目录并更新索引后，应能继续上一条请求，对齐 WB-BLOCKER-002-AC1、WB-BLOCKER-002-AC2。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})

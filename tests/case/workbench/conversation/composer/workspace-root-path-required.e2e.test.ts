import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createTemporaryWorkbenchWorkspace,
  createWorkspaceThroughSettingsUi,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  setWorkbenchInput,
  switchWorkbenchMode,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  bindWorkspaceRootDirectly,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

const CASE_ID = 'workspace-root-path-required'
const WORKSPACE_NAME = 'Workbench Root Path Required Workspace'
const PROMPT = '请用一句话确认当前工作区中 human-input.txt 存在。'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '未设置工作目录的工作区应禁用发送；绑定目录后恢复可发送并走真实 AI 运行。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const env = loadWorkbenchLiveModelEnv()
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          await configureLiveModelThroughSettingsUi(page, env)
          const workspaceId = await createWorkspaceThroughSettingsUi(page, WORKSPACE_NAME)

          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
          await selectWorkbenchModel(page, env.modelName)
          await switchWorkbenchMode(page, 'AI')
          await setWorkbenchInput(page, PROMPT)

          const disabledBeforeBinding = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)
          const composerHintBeforeBinding = (
            (await getWorkbenchLocator(page, workbenchSelectors.composerHint).textContent()) || ''
          ).trim()

          await navigateToSettingsSection(page, 'workspace')
          await bindWorkspaceRootDirectly(page, workspaceId, workspace.rootPath)
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
          await selectWorkbenchModel(page, env.modelName)
          await switchWorkbenchMode(page, 'AI')
          await setWorkbenchInput(page, PROMPT)

          const disabledAfterBinding = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)
          const composerHintVisibleAfterBinding = await getWorkbenchLocator(
            page,
            workbenchSelectors.composerHint
          )
            .isVisible()
            .catch(() => false)

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(page, PROMPT)
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.75)

          return {
            disabledBeforeBinding,
            composerHintBeforeBinding,
            disabledAfterBinding,
            composerHintVisibleAfterBinding,
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.disabledBeforeBinding &&
              result.composerHintBeforeBinding.includes('当前工作区未设置文件目录') &&
              !result.disabledAfterBinding &&
              !result.composerHintVisibleAfterBinding &&
              result.eventTypes.includes('run_completed') &&
              !result.eventTypes.includes('workspace_required') &&
              result.finalAnswerText.trim().length > 0,
            {
              name: 'workbench-workspace-root-path-required-real',
              message:
                '未设置工作目录的工作区应禁用 Workbench 发送并提示前往设置；绑定目录后恢复发送并完成真实 AI 运行，对齐 WB-COMPOSER-005、WB-CORE-006。Settings 未绑目录文案由 workspace-add-selection-flow 覆盖 SET-WORKSPACE-006-AC3。',
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

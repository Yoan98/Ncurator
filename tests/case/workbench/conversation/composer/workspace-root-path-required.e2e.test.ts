import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  createWorkspaceThroughSettingsUi,
  getWorkbenchLocator,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  sendWorkbenchMessage,
  setWorkbenchInput,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'workspace-root-path-required'
const PARTNER_NAME = '发送前置伙伴'
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
        description: '未创建伙伴时不能发送；创建伙伴后可以发送并走真实 AI 运行。',
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
          await createWorkspaceThroughSettingsUi(page, workspace.rootPath)
          await navigateToWorkbench(page)
          await selectWorkbenchModel(page, env.modelName)
          await setWorkbenchInput(page, PROMPT)

          const disabledBeforePartner = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)

          await createPartnerThroughWorkbenchUi(page, PARTNER_NAME)
          await setWorkbenchInput(page, PROMPT)
          const disabledAfterPartner = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).evaluate((element) => element instanceof HTMLButtonElement && element.disabled)

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
          await assertNoWorkbenchFakeSignals(page)

          return {
            disabledBeforePartner,
            disabledAfterPartner,
            finalAnswerLength: evidence.finalAnswerText.trim().length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.disabledBeforePartner && !result.disabledAfterPartner, {
            name: 'partner-is-required-before-send',
            message: '未创建伙伴时发送应被禁用；创建伙伴后可以发送，对齐 WB-COMPOSER 发送前置。',
            data: result
          })
          await runtime.assertThat(result.finalAnswerLength > 0, {
            name: 'partner-ready-run-completes',
            message: '创建伙伴后真实 AI 运行应完成并给出回答。',
            data: result
          })
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})

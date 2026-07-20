import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  recordWorkbenchAiEvidence,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForLatestAssistantFinalAnswerText,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { navigateToSettingsSection } from '../../../../harness/e2e/settings'

const CASE_ID = 'run-navigation-snapshot-replay'
const PROMPT =
  '请只依据当前工作区里的资料，用 keyword 检索 Alice 和 Bob 相关内容，整理对外同步结论，并用 5 条以内项目符号回答。'
const WORKSPACE_NAME = 'Workbench Run Persistence Workspace'

describe('workbench run persistence e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['persistence'],
        description:
          '真实 AI 输出过程中切到 Settings，完成后回到 Workbench，通过 session snapshot replay 恢复过程流和最终回答。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: WORKSPACE_NAME,
            createSession: false
          })
          try {
            await navigateToWorkbench(page)
            await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, PROMPT)
            const processLocator = await waitForLatestAssistantProcess(page)
            const processTextBeforeNavigation = ((await processLocator.textContent()) || '').trim()

            await navigateToSettingsSection(page, 'workspace')
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            await navigateToWorkbench(page)

            const finalAnswerText = await waitForLatestAssistantFinalAnswerText(page)
            const processItemCount = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantProcessItemPrefix
            ).count()
            recordWorkbenchAiEvidence(runtime, evidence, 0.85)

            return {
              processTextBeforeNavigation,
              processItemCount,
              finalAnswerText,
              eventTypes: evidence.events.map((event) => event.type)
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.processTextBeforeNavigation.length > 0 &&
              result.eventTypes.includes('answer_completed') &&
              result.eventTypes.includes('run_completed') &&
              /Alice|合规负责人/u.test(result.finalAnswerText) &&
              /Bob|财务接口人/u.test(result.finalAnswerText),
            {
              name: 'workbench-run-navigation-snapshot-replay',
              message:
                'AI 输出中离开 Workbench 再返回时，应通过持久化 snapshot replay 恢复过程流和最终回答，对齐 WB-SESSION-002-AC3、WB-COMPOSER-003-AC7。',
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

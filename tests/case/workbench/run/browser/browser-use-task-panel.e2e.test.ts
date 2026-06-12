import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  chatSelectors,
  getApprovalCard,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-use-task-panel'
const TASK_CODE = 'cedar-browser-731'

describe('workbench run e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['browser'],
      description: '真实 AI 使用 browser_use 操作本地网页，验证右侧浏览器面板、网页结果和最终回答闭环。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const server = await startLocalWorkbenchHttpServer(`<!doctype html>
          <title>Workbench Browser Task</title>
          <label>任务口令 <input id="task-code" aria-label="任务口令" /></label>
          <button id="submit-task">提交任务</button>
          <output id="task-result">等待提交</output>
          <script>
            document.querySelector('#submit-task').addEventListener('click', () => {
              document.querySelector('#task-result').textContent = 'BROWSER_TASK_DONE:' + document.querySelector('#task-code').value
            })
          </script>`)
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请使用右侧内置浏览器打开 ${server.url}，在“任务口令”输入框填入 ${TASK_CODE}，点击“提交任务”，然后告诉我页面显示的完整结果。不要只抓取源码，必须实际操作页面。`
          )

          const approvalVisible = await getApprovalCard(page)
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false)
          if (approvalVisible) {
            await getWorkbenchLocator(page, chatSelectors.approvalBatchApproveButton).click()
          }

          await waitForWorkbenchAiEvent(runtime, {
            name: 'browser_panel_opened',
            matches: (event) => event.type === 'browser_panel_opened'
          })
          await getWorkbenchLocator(page, workbenchSelectors.browserPanel).waitFor({
            state: 'visible'
          })
          await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({
            state: 'visible'
          })
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)

          return {
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type),
            usedBrowserTool: evidence.events.some(
              (event) => event.type === 'tool_call_result' && event.toolName === 'browser_use'
            )
          }
        } finally {
          await setup.workspace.cleanup()
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.eventTypes.includes('browser_panel_opened') &&
            result.usedBrowserTool &&
            /BROWSER_TASK_DONE/u.test(result.finalAnswerText) &&
            result.finalAnswerText.includes(TASK_CODE),
          {
            name: 'workbench-browser-use-panel-real',
            message:
              '真实 browser_use 任务应打开右侧内置浏览器、操作本地网页并在最终回答中回收网页操作结果，对齐 WB-PANEL-004-AC1 至 WB-PANEL-004-AC4、WB-CORE-005、WB-CORE-006。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})

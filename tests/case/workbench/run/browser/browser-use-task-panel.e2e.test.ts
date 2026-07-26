import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  type WorkbenchAiCompletionEvidence,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-use-task-panel'
const TASK_CODE = 'cedar-browser-731'
const BROWSER_PANEL_WAIT_TIMEOUT_MS = 180_000
const BROWSER_TASK_COMPLETION_TIMEOUT_MS = 240_000
const BROWSER_USE_FAILURE_LIMIT = 2
const DEPRECATED_BROWSER_USE_FIELDS = [
  'summary',
  'content',
  'pageState',
  'outcome',
  'pageText',
  'selector',
  'cacheStatus'
]

const isObjectRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readToolInputString = (
  event: Extract<AiRunEvent, { type: 'tool_call_started' }>,
  key: string
): string => {
  const input = event.input as JsonValue
  if (!isObjectRecord(input)) return ''
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

const hasDeprecatedBrowserUseField = (value: JsonValue | undefined, isRoot = true): boolean => {
  if (Array.isArray(value)) return value.some((item) => hasDeprecatedBrowserUseField(item, false))
  if (!isObjectRecord(value)) return false
  return Object.entries(value).some(([key, child]) => {
    if (isRoot && (key === 'url' || key === 'title' || key === 'success' || key === 'message')) {
      return true
    }
    if (DEPRECATED_BROWSER_USE_FIELDS.includes(key)) return true
    return hasDeprecatedBrowserUseField(child, false)
  })
}

const isBrowserUseDataContract = (data: JsonValue | undefined): boolean => {
  if (!isObjectRecord(data)) return false
  const action = data.action
  if (action !== 'navigate' && action !== 'observe' && action !== 'act' && action !== 'extract') {
    return typeof data.error === 'string'
  }
  if (!isObjectRecord(data.page) || typeof data.page.url !== 'string') return false
  if ('title' in data.page && typeof data.page.title !== 'string') return false
  if (action === 'navigate') return data.result === null
  if (!isObjectRecord(data.result)) return false
  if (action === 'extract') return typeof data.result.extracted === 'string'
  if (action === 'observe') return Array.isArray(data.result.actions)
  return (
    typeof data.result.success === 'boolean' &&
    typeof data.result.message === 'string' &&
    typeof data.result.actionDescription === 'string' &&
    Array.isArray(data.result.actions)
  )
}

const readBrowserUseResultText = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): string => {
  const data = event.result?.data
  if (!isObjectRecord(data) || !isObjectRecord(data.result)) return ''
  const parts: string[] = []
  for (const key of ['extracted', 'message', 'actionDescription']) {
    const value = data.result[key]
    if (typeof value === 'string') parts.push(value)
  }
  return parts.join('\n')
}

const isApprovalBatchRequiredEvent = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

const waitForBrowserPanelOpenedWithApproval = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
): Promise<void> => {
  const handledBatchIds = new Set<string>()
  const deadline = Date.now() + BROWSER_PANEL_WAIT_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for browser panel: ${failed.message}`)
    }
    if (events.some((event) => event.type === 'browser_panel_opened')) return

    const approvalRequired = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
          isApprovalBatchRequiredEvent(event) && !handledBatchIds.has(event.batchId)
      )
      .at(-1)
    if (approvalRequired) {
      handledBatchIds.add(approvalRequired.batchId)
      await decideWorkbenchApprovalBatch(runtime, runtime.page, {
        event: approvalRequired,
        action: 'approve'
      })
      continue
    }

    if (Date.now() >= deadline) {
      throw new Error('browser panel did not open before timeout')
    }
    await runtime.page.waitForTimeout(500)
  }
}

const waitForBrowserTaskCompletion = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0],
  startedAtMs: number,
  modelName: string
): Promise<WorkbenchAiCompletionEvidence> => {
  const deadline = Date.now() + BROWSER_TASK_COMPLETION_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for browser task: ${failed.message}`)
    }

    const browserUseFailures = events.filter(
      (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
        event.type === 'tool_call_result' &&
        event.toolName === 'browser_use' &&
        (Boolean(event.error) || event.result?.ok === false)
    )
    if (browserUseFailures.length >= BROWSER_USE_FAILURE_LIMIT) {
      const latestFailure = browserUseFailures.at(-1)
      runtime.signal({
        name: 'workbench-browser-use-repeated-failure',
        status: 'failed',
        message: 'browser_use 连续失败，停止等待模型重复重试。',
        data: {
          failureCount: browserUseFailures.length,
          latestFailure: latestFailure
            ? {
                toolCallId: latestFailure.toolCallId,
                error: latestFailure.error || '',
                result: latestFailure.result || null
              }
            : null
        }
      })
      throw new Error(
        `browser_use failed ${browserUseFailures.length} times; latest=${JSON.stringify(
          latestFailure?.result || latestFailure?.error || null
        )}`
      )
    }

    const runCompleted = events.find((event) => event.type === 'run_completed')
    const browserTaskDoneText = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
          event.type === 'tool_call_result' && event.toolName === 'browser_use'
      )
      .map(readBrowserUseResultText)
      .find((text) => text.includes('BROWSER_TASK_DONE') && text.includes(TASK_CODE))
    if (runCompleted?.type === 'run_completed') {
      const finalAnswerText =
        events
          .filter(
            (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
              event.type === 'answer_completed'
          )
          .map((event) => event.text)
          .at(-1) || ''
      return {
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText
      }
    }
    if (browserTaskDoneText) {
      const finalAnswerText =
        events
          .filter(
            (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
              event.type === 'answer_completed'
          )
          .map((event) => event.text)
          .at(-1) || browserTaskDoneText
      return {
        modelName,
        durationMs: Date.now() - startedAtMs,
        events,
        finalAnswerText
      }
    }

    if (Date.now() >= deadline) {
      throw new Error('browser task did not complete before timeout')
    }
    await runtime.page.waitForTimeout(500)
  }
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description:
          '真实 AI 使用 browser_use 操作本地网页，验证右侧浏览器面板、网页结果和最终回答闭环。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(`<!doctype html>
          <title>Workbench Browser Task</title>
          <label>Task code <input id="task-code" aria-label="Task code" /></label>
          <button id="submit-task">Submit task</button>
          <output id="task-result">Waiting for submit</output>
          <script>
            document.querySelector('#submit-task').addEventListener('click', () => {
              document.querySelector('#task-result').textContent = 'BROWSER_TASK_DONE:' + document.querySelector('#task-code').value
            })
          </script>`)
          runtime.registerResource({
            name: 'browser-task-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          await switchWorkbenchMode(page, '没头脑')
          await insertWorkbenchReferenceToken(page, 'workbench-preview.md')
          await appendWorkbenchInputText(page, 'cedar-markdown-preview-442')
          await submitWorkbenchCurrentDraft(page)
          const previewResults = await waitForWorkbenchSearchResults(page)
          await previewResults
            .locator('div')
            .filter({ hasText: 'workbench-preview.md' })
            .first()
            .getByRole('button', { name: '预览文件' })
            .click()
          await getWorkbenchLocator(page, workbenchSelectors.markdownViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })

          await switchWorkbenchMode(page, '大聪明')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `Use the right embedded browser to complete this page task. Use browser_use navigate to open ${server.url}, use observe to inspect the form controls, then do not combine form actions: use one act to fill the Task code input with ${TASK_CODE}, call wait_time exactly once for 1 second, use another act to click Submit task, then use extract to read the full displayed result. Tell me the exact result text.`
          )

          await waitForBrowserPanelOpenedWithApproval(runtime)
          await getWorkbenchLocator(page, workbenchSelectors.browserPanel).waitFor({
            state: 'visible'
          })
          await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({
            state: 'visible'
          })
          const resourceTabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          const initialResourceTabCount = await resourceTabs.count()
          const openedEvent = (await collectWorkbenchAiRunEvents(runtime))
            .filter(
              (event): event is Extract<AiRunEvent, { type: 'browser_panel_opened' }> =>
                event.type === 'browser_panel_opened'
            )
            .at(-1)
          if (!openedEvent) throw new Error('browser_panel_opened event is missing')
          await getWorkbenchLocator(page, workbenchSelectors.resourceTabAddButton).click()
          const openFileMenuItem = page.getByRole('menuitem', { name: '文件', exact: true })
          await openFileMenuItem.waitFor({ state: 'visible', timeout: 10_000 })
          const openFileMenuItemVisible = await openFileMenuItem.isVisible()
          await page.getByRole('menuitem', { name: '浏览器' }).click()
          await resourceTabs.nth(2).waitFor({ state: 'visible', timeout: 10_000 })
          const resourceTabCountAfterReopen = await resourceTabs.count()
          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const browserBackButtonCount = await browserPanel
            .getByRole('button', { name: /后退|back/i })
            .count()
          const evidence = await waitForBrowserTaskCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const browserStarts = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
              event.type === 'tool_call_started' && event.toolName === 'browser_use'
          )
          const browserResults = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
              event.type === 'tool_call_result' && event.toolName === 'browser_use'
          )
          const browserData = browserResults.map((event) => event.result?.data)
          const waitStarts = evidence.events.filter(
            (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
              event.type === 'tool_call_started' && event.toolName === 'wait_time'
          )
          const processItemTexts = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessItemPrefix
          ).allTextContents()
          const processBlocks = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessItemPrefix
          )
          const executionSummaryTexts = await processBlocks.locator('summary').allTextContents()
          const executionIconKinds = await processBlocks
            .locator('summary [data-process-icon-kind]')
            .evaluateAll((icons) =>
              icons.map((icon) => icon.getAttribute('data-process-icon-kind') || '')
            )
          await processBlocks.evaluateAll((blocks) => {
            for (const block of blocks) {
              if (block.querySelector('summary + div')) block.setAttribute('open', '')
            }
          })
          const browserExecutionItems = processBlocks.locator('summary + div > div')
          const browserExecutionItemTexts = await browserExecutionItems.allTextContents()
          const browserExecutionItemFontWeights = await browserExecutionItems.evaluateAll((items) =>
            items.map((item) => window.getComputedStyle(item).fontWeight)
          )
          await resourceTabs.filter({ hasText: 'workbench-preview.md' }).first().click()
          const fileTabRestored = await getWorkbenchLocator(page, workbenchSelectors.markdownViewer)
            .waitFor({ state: 'visible', timeout: 30_000 })
            .then(() => true)
            .catch(() => false)
          const browserStateWhileHidden = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            openedEvent.browserTabId
          )
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.resourceTabPrefix}-browser-${openedEvent.browserTabId}`
          ).click()
          await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({
            state: 'visible'
          })
          const browserStateAfterRestore = await page.evaluate(
            async (tabId) => window.api.browserPanelStateGet({ tabId }),
            openedEvent.browserTabId
          )

          return {
            finalAnswerText: evidence.finalAnswerText,
            eventTypes: evidence.events.map((event) => event.type),
            browserBackButtonCount,
            initialResourceTabCount,
            openFileMenuItemVisible,
            resourceTabCountAfterReopen,
            fileTabRestored,
            browserUrlPreserved:
              browserStateWhileHidden.success &&
              browserStateAfterRestore.success &&
              browserStateWhileHidden.state?.url === server.url &&
              browserStateAfterRestore.state?.url === server.url,
            browserActions: browserStarts.map((event) => readToolInputString(event, 'action')),
            waitCallCount: waitStarts.length,
            executionSummaryTexts,
            executionIconKinds,
            browserExecutionItemTexts,
            browserExecutionItemFontWeights,
            redundantBrowserActionPrefixesAbsent: processItemTexts.every(
              (text) =>
                !text.includes('观察页面：') &&
                !text.includes('提取页面内容：') &&
                !text.includes('操作页面：')
            ),
            browserResultContractValid:
              browserData.length > 0 && browserData.every(isBrowserUseDataContract),
            deprecatedBrowserUseFieldsAbsent: browserData.every(
              (data) => !hasDeprecatedBrowserUseField(data)
            ),
            observeResultVisible: browserData.some(
              (data) =>
                isObjectRecord(data) &&
                data.action === 'observe' &&
                isObjectRecord(data.result) &&
                Array.isArray(data.result.actions)
            ),
            actResultVisible: browserData.some(
              (data) =>
                isObjectRecord(data) &&
                data.action === 'act' &&
                isObjectRecord(data.result) &&
                typeof data.result.success === 'boolean' &&
                typeof data.result.message === 'string' &&
                typeof data.result.actionDescription === 'string' &&
                Array.isArray(data.result.actions)
            ),
            extractResultVisible: browserData.some(
              (data) =>
                isObjectRecord(data) &&
                data.action === 'extract' &&
                isObjectRecord(data.result) &&
                typeof data.result.extracted === 'string' &&
                data.result.extracted.includes('BROWSER_TASK_DONE')
            )
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('browser_panel_opened') &&
              result.browserActions.includes('navigate') &&
              result.browserActions.includes('observe') &&
              result.browserActions.includes('act') &&
              result.browserActions.includes('extract') &&
              result.waitCallCount === 1 &&
              result.executionSummaryTexts.some((text) => text.includes('已操作浏览器')) &&
              result.executionSummaryTexts.some((text) => text.includes('等待 1 秒')) &&
              result.executionSummaryTexts.every((text) => !text.includes('，')) &&
              (result.executionIconKinds.includes('workflow') ||
                (result.executionIconKinds.includes('browser') &&
                  result.executionIconKinds.includes('wait'))) &&
              result.browserExecutionItemTexts.length > 0 &&
              result.browserExecutionItemTexts.every((text) => !text.includes('：')) &&
              result.browserExecutionItemFontWeights.every(
                (weight) => Number.parseInt(weight, 10) < 600
              ) &&
              result.browserResultContractValid &&
              result.redundantBrowserActionPrefixesAbsent &&
              result.deprecatedBrowserUseFieldsAbsent &&
              result.observeResultVisible &&
              result.actResultVisible &&
              result.extractResultVisible &&
              result.initialResourceTabCount === 2 &&
              result.openFileMenuItemVisible &&
              result.resourceTabCountAfterReopen === 3 &&
              result.fileTabRestored &&
              result.browserUrlPreserved &&
              result.browserBackButtonCount === 1 &&
              /BROWSER_TASK_DONE/u.test(result.finalAnswerText) &&
              result.finalAnswerText.includes(TASK_CODE),
            {
              name: 'workbench-browser-use-panel-real',
              message:
                '真实 browser_use 任务应允许新增独立浏览器 Tab，保留已打开文件和原网页状态，并完成网页操作与最终回答闭环。',
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

import { describe, it } from 'vitest'
import type { AiRunEvent, JsonValue } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  type WorkbenchAiCompletionEvidence,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  switchWorkbenchMode,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-use-task-panel'
const LOGOUT_TOKEN = 'LOGOUT_OK_cedar-browser-731'
const BROWSER_PANEL_WAIT_TIMEOUT_MS = 180_000
const BROWSER_TASK_COMPLETION_TIMEOUT_MS = 240_000
const BROWSER_USE_FAILURE_LIMIT = 2
const DEPRECATED_BROWSER_USE_FIELDS = [
  'summary',
  'pageState',
  'outcome',
  'pageText',
  'cacheStatus',
  'success'
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

const hasDeprecatedBrowserUseField = (value: JsonValue | undefined): boolean => {
  if (Array.isArray(value)) return value.some((item) => hasDeprecatedBrowserUseField(item))
  if (!isObjectRecord(value)) return false
  return Object.entries(value).some(([key, child]) => {
    if (DEPRECATED_BROWSER_USE_FIELDS.includes(key)) return true
    if (key === 'result') return true
    return hasDeprecatedBrowserUseField(child)
  })
}

const isBrowserActionCandidate = (value: JsonValue | undefined): boolean => {
  if (!isObjectRecord(value)) return false
  return (
    typeof value.actionId === 'string' &&
    typeof value.method === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.arguments) &&
    typeof value.selector === 'string'
  )
}

const isBrowserUseDataContract = (data: JsonValue | undefined): boolean => {
  if (!isObjectRecord(data)) return false
  if (typeof data.error === 'string') return true
  const action = data.action
  if (
    action !== 'navigate' &&
    action !== 'list_tabs' &&
    action !== 'observe' &&
    action !== 'act' &&
    action !== 'extract' &&
    action !== 'screenshot' &&
    action !== 'scroll'
  ) {
    return false
  }
  if (action === 'list_tabs') {
    return Array.isArray(data.tabs)
  }
  if (typeof data.tabId !== 'string') return false
  if (!isObjectRecord(data.page) || typeof data.page.url !== 'string') return false
  if ('title' in data.page && typeof data.page.title !== 'string') return false
  if (action === 'navigate') return true
  if (action === 'extract') return typeof data.content === 'string'
  if (action === 'screenshot') return typeof data.path === 'string'
  if (action === 'scroll') {
    return typeof data.message === 'string' && typeof data.scrolledPixels === 'number'
  }
  if (action === 'observe') {
    return Array.isArray(data.actions) && data.actions.every(isBrowserActionCandidate)
  }
  return (
    typeof data.message === 'string' &&
    typeof data.actionDescription === 'string' &&
    isBrowserActionCandidate(data.executed) &&
    (!('error' in data) || typeof data.error === 'string')
  )
}

const readBrowserUseResultText = (
  event: Extract<AiRunEvent, { type: 'tool_call_result' }>
): string => {
  const data = event.result?.data
  if (!isObjectRecord(data)) return ''
  const parts: string[] = []
  if (typeof data.content === 'string') parts.push(data.content)
  for (const key of ['message', 'actionDescription']) {
    const value = data[key]
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
      .find((text) => text.includes(LOGOUT_TOKEN))
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

const waitForBrowserTaskPause = async (
  runtime: Parameters<typeof collectWorkbenchAiRunEvents>[0]
): Promise<void> => {
  const deadline = Date.now() + BROWSER_PANEL_WAIT_TIMEOUT_MS
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for browser task pause: ${failed.message}`)
    }
    if (
      events.some((event) => event.type === 'tool_call_started' && event.toolName === 'browser_use')
    ) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error('browser task did not enter the requested pause before timeout')
    }
    await runtime.page.waitForTimeout(100)
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
          <html>
          <head>
            <meta charset="utf-8" />
            <title>Workbench Account Center</title>
            <style>
              * { box-sizing: border-box; }
              body { font-family: sans-serif; margin: 0; padding: 16px; background: #f7f8fa; }
              header { display: flex; gap: 12px; align-items: center; padding: 12px; background: #fff; border-radius: 8px; margin-bottom: 16px; }
              .hero { background: #fff; padding: 24px; border-radius: 8px; margin-bottom: 24px; min-height: 800px; }
              .hero h2 { margin-top: 0; }
              .card { background: #f0f2f5; padding: 16px; border-radius: 6px; margin-bottom: 12px; }
              .footer-zone { background: #fff; padding: 24px; border-radius: 8px; border: 1px dashed #d0d7de; margin-top: 40px; }
              #logout { background: #d93025; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-size: 14px; }
              #status { font-weight: bold; margin-top: 12px; color: #1a73e8; }
            </style>
          </head>
          <body>
            <header>
              <span>用户中心</span>
              <button id="role" type="button">教师身份</button>
              <button id="msg" type="button" aria-label="消息通知">消息通知 (3)</button>
            </header>
            <section class="hero">
              <h2>工作台概览与日常事务</h2>
              <p>欢迎回到工作台。此区域展示近期的教学安排与日常统计数据。</p>
              <div class="card"><h3>学期进度</h3><p>当前学期教学计划已完成 65%，期末复习大纲已归档。</p></div>
              <div class="card"><h3>通知公告</h3><p>下周教室资源调整通知已发送至各院系邮箱。</p></div>
              <div class="card"><h3>教学日志</h3><p>昨日随堂测试成绩已同步录入教务分析系统。</p></div>
              <div class="card"><h3>系统提示</h3><p>如需管理账号或注销退出，请浏览至页面底部账号设置区。</p></div>
            </section>
            <section class="footer-zone">
              <h3>账号安全与设置</h3>
              <p>当前登录账号处于活跃状态。如需更换账号，请点击下方退出登录。</p>
              <button id="logout" type="button">退出登录</button>
              <main id="status">已登录</main>
            </section>
            <script>
              const logout = document.querySelector('#logout');
              const status = document.querySelector('#status');
              logout.addEventListener('click', () => {
                status.textContent = '${LOGOUT_TOKEN}';
              });
            </script>
          </body>
          </html>`)
          runtime.registerResource({
            name: 'browser-task-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          const panelToggleForFile = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggleForFile.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggleForFile.click()
          }
          await selectWorkbenchResourceMenuItem(runtime, 'file')
          const fileFilter = page.getByPlaceholder('筛选文件…')
          if (!(await fileFilter.isVisible().catch(() => false))) {
            await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
            await fileFilter.waitFor({ state: 'visible' })
          }
          await fileFilter.fill('workbench-preview.md')
          await page.getByTitle('workbench-preview.md', { exact: true }).click()
          await getWorkbenchLocator(page, workbenchSelectors.markdownEditor).waitFor({
            state: 'visible',
            timeout: 30_000
          })

          await switchWorkbenchMode(page, 'AI')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请在右侧内置浏览器中打开 ${server.url}，浏览并找到底部的退出登录按钮执行退出，然后提取 #status 的最终状态文本告诉我。`
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
          const inspectTaskBrowserRuntime = async () =>
            await runtime.electronApp.evaluate(async ({ webContents }, url) => {
              const allContents = webContents.getAllWebContents().map((candidate) => ({
                id: candidate.id,
                url: candidate.getURL(),
                destroyed: candidate.isDestroyed()
              }))
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL() === url)
              if (!contents || contents.isDestroyed()) {
                return { alive: false, id: null, resultText: null, allContents }
              }
              const resultText = (await contents.executeJavaScript(
                `document.querySelector('#status')?.textContent || null`
              )) as string | null
              return { alive: true, id: contents.id, resultText, allContents }
            }, server.url)
          const waitForTaskBrowserRuntime = async () => {
            let browser = await inspectTaskBrowserRuntime()
            for (let attempt = 0; attempt < 100 && !browser.alive; attempt += 1) {
              await page.waitForTimeout(100)
              browser = await inspectTaskBrowserRuntime()
            }
            return browser
          }
          const taskBrowserBeforeBackground = await waitForTaskBrowserRuntime()
          await waitForBrowserTaskPause(runtime)
          const resourceMenu = await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const openFileMenuItemVisible = resourceMenu.fileVisible
          await resourceTabs.nth(initialResourceTabCount).waitFor({ state: 'visible', timeout: 10_000 })
          const resourceTabCountAfterReopen = await resourceTabs.count()
          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const browserBackButtonCount = await browserPanel
            .getByRole('button', { name: /后退|back/i })
            .count()
          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          await panelToggle.click()
          await page.waitForFunction(
            (testId) => document.querySelector(`[data-testid="${testId}"]`) === null,
            workbenchSelectors.contentPanelShell
          )
          const taskBrowserWhileCollapsed = await inspectTaskBrowserRuntime()
          const evidence = await waitForBrowserTaskCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          const taskBrowserAfterBackgroundRun = await inspectTaskBrowserRuntime()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
          }, workbenchSelectors.contentPanelShell)
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.resourceTabPrefix}-browser-${openedEvent.browserTabId}`
          ).evaluate((element) => (element as HTMLElement).click())
          await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({
            state: 'visible'
          })
          const taskBrowserAfterRestore = await inspectTaskBrowserRuntime()
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
          // The native BrowserView overlaps the renderer during its panel transition. Use the
          // same DOM activation path as the browser-tab restore above so this assertion verifies
          // resource switching instead of Playwright's native-surface hit testing.
          await resourceTabs
            .filter({ hasText: 'workbench-preview.md' })
            .first()
            .evaluate((element) => (element as HTMLElement).click())
          const fileTabRestored = await getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
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
          ).evaluate((element) => (element as HTMLElement).click())
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
            backgroundBrowserStayedAlive:
              taskBrowserBeforeBackground.alive && taskBrowserWhileCollapsed.alive,
            browserRuntimeBeforeBackground: taskBrowserBeforeBackground,
            browserRuntimeWhileCollapsed: taskBrowserWhileCollapsed,
            browserRuntimeAfterBackgroundRun: taskBrowserAfterBackgroundRun,
            browserRuntimeAfterRestore: taskBrowserAfterRestore,
            backgroundBrowserFinishedTask:
              taskBrowserAfterBackgroundRun.resultText === LOGOUT_TOKEN,
            restoredLatestBrowserState:
              taskBrowserAfterRestore.resultText === LOGOUT_TOKEN,
            browserWebContentsPreserved:
              taskBrowserBeforeBackground.id !== null &&
              taskBrowserBeforeBackground.id === taskBrowserWhileCollapsed.id &&
              taskBrowserBeforeBackground.id === taskBrowserAfterBackgroundRun.id &&
              taskBrowserBeforeBackground.id === taskBrowserAfterRestore.id,
            fileTabRestored,
            browserUrlPreserved:
              browserStateWhileHidden.success &&
              browserStateAfterRestore.success &&
              browserStateWhileHidden.state?.url === server.url &&
              browserStateAfterRestore.state?.url === server.url,
            browserActions: browserStarts.map((event) => readToolInputString(event, 'action')),
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
                Array.isArray(data.actions) &&
                data.actions.every(isBrowserActionCandidate)
            ),
            actUsesActionId: browserStarts.every((event) => {
              if (readToolInputString(event, 'action') !== 'act') return true
              return Boolean(readToolInputString(event, 'actionId'))
            }),
            actOmitsInstruction: browserStarts.every((event) => {
              if (readToolInputString(event, 'action') !== 'act') return true
              const input = event.input
              return !(isObjectRecord(input) && 'instruction' in input)
            }),
            followUpCallsUseTabId: (() => {
              const navigateResult = browserData.find(
                (data) => isObjectRecord(data) && data.action === 'navigate'
              )
              if (!isObjectRecord(navigateResult) || typeof navigateResult.tabId !== 'string') {
                return false
              }
              const tabId = navigateResult.tabId
              return browserStarts.every((event) => {
                const action = readToolInputString(event, 'action')
                if (action === 'navigate' || action === 'list_tabs' || !action) return true
                return readToolInputString(event, 'tabId') === tabId
              })
            })(),
            actResultVisible: browserData.some(
              (data) =>
                isObjectRecord(data) &&
                data.action === 'act' &&
                typeof data.message === 'string' &&
                typeof data.actionDescription === 'string' &&
                isBrowserActionCandidate(data.executed)
            ),
            extractResultVisible: browserData.some(
              (data) =>
                isObjectRecord(data) &&
                data.action === 'extract' &&
                typeof data.content === 'string' &&
                data.content.includes(LOGOUT_TOKEN)
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
              result.executionSummaryTexts.some(
                (text) =>
                  /已完成\s+\d+\s*项/u.test(text) ||
                  text.includes('项操作') ||
                  text.includes('打开网页') ||
                  text.includes('操作浏览器')
              ) &&
              result.executionSummaryTexts.every((text) => !text.includes('，')) &&
              (result.executionIconKinds.includes('workflow') ||
                result.executionIconKinds.includes('browser')) &&
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
              result.actUsesActionId &&
              result.actOmitsInstruction &&
              result.followUpCallsUseTabId &&
              result.extractResultVisible &&
              result.initialResourceTabCount === 2 &&
              result.openFileMenuItemVisible &&
              result.resourceTabCountAfterReopen === 3 &&
              result.backgroundBrowserStayedAlive &&
              result.backgroundBrowserFinishedTask &&
              result.restoredLatestBrowserState &&
              result.browserWebContentsPreserved &&
              result.fileTabRestored &&
              result.browserUrlPreserved &&
              result.browserBackButtonCount === 1 &&
              result.finalAnswerText.includes(LOGOUT_TOKEN),
            {
              name: 'workbench-browser-use-panel-real',
              message:
                '真实 browser_use 应走 observe→actionId act（含 hover 退出），右栏折叠后继续同一实例，并保留文件与多浏览器 Tab。',
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

import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { clickScreenPoint } from '../../../../harness/e2e/nativeMouse'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  decideWorkbenchApprovalBatch,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'user-takeover-flow'
const TAKEOVER_MESSAGE = '请在右侧完成页面确认'
const COMPLETION_TEXT = 'USER_TAKEOVER_DONE:maple-482'

const isApprovalRequired = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

const isUserTakeoverRequired = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'user_takeover_required' }> =>
  event.type === 'user_takeover_required'

const readBrowserAction = (event: AiRunEvent): string => {
  if (event.type !== 'tool_call_started' || event.toolName !== 'browser_use') return ''
  const action = event.input.action
  return typeof action === 'string' ? action : ''
}

describe('workbench run e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['blocker'],
        description:
          '真实 AI 在内置浏览器遇到人工步骤后调用 wait_for_user_takeover，验证暂停、用户操作、确认和恢复闭环。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(`<!doctype html>
            <title>User Takeover Task</title>
            <h1>Manual action required</h1>
            <p>此步骤必须由用户本人点击确认，AI 不得代替操作。</p>
            <button id="complete-manual" type="button">用户确认</button>
            <output id="manual-result">WAITING_FOR_USER</output>
            <script>
              document.querySelector('#complete-manual').addEventListener('click', () => {
                document.querySelector('#manual-result').textContent = '${COMPLETION_TEXT}'
              })
            </script>`)
          runtime.registerResource({
            name: 'user-takeover-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })

          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请严格按顺序完成任务：先用 browser_use navigate 打开 ${server.url}，再用 observe 查看页面。页面要求用户本人操作时，不要替用户点击，调用 wait_for_user_takeover，message 必须是“${TAKEOVER_MESSAGE}”。用户确认完成后，先用 observe 重新查看页面，再用 extract 读取结果，最终原样告诉我结果文字。`
          )

          const approval = await waitForWorkbenchAiEvent(runtime, {
            name: 'user_takeover_browser_approval',
            matches: isApprovalRequired
          })
          if (!isApprovalRequired(approval)) throw new Error('browser approval was not required')
          await decideWorkbenchApprovalBatch(runtime, page, {
            event: approval,
            action: 'approve'
          })

          const takeover = await waitForWorkbenchAiEvent(runtime, {
            name: 'user_takeover_required',
            matches: isUserTakeoverRequired,
            timeoutMs: 180_000
          })
          if (!isUserTakeoverRequired(takeover)) {
            throw new Error('user takeover was not requested')
          }

          const takeoverPanel = getWorkbenchLocator(page, workbenchSelectors.userTakeoverPanel)
          await takeoverPanel.waitFor({ state: 'visible' })
          const panelMessage =
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.userTakeoverMessage
            ).textContent()) || ''
          const composerHidden = !(await getWorkbenchLocator(page, workbenchSelectors.input)
            .isVisible()
            .catch(() => false))
          await getWorkbenchLocator(page, workbenchSelectors.browserPanel).waitFor({
            state: 'visible'
          })
          const taskBrowserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .filter({ hasText: 'User Takeover Task' })
            .first()
          await taskBrowserTab.waitFor({ state: 'visible' })
          await taskBrowserTab.click()
          await page.waitForTimeout(300)
          await runtime.captureScreenshot({
            name: 'user-takeover-panel',
            message: 'AI 已暂停，输入框位置显示用户接手面板，右侧浏览器保持打开。'
          })

          const browserTarget = await runtime.electronApp.evaluate(
            async ({ BrowserWindow, WebContentsView, screen, webContents }, input) => {
              const allContents = webContents.getAllWebContents()
              const browserContents = allContents.find((item) =>
                item.getURL().startsWith(input.url)
              )
              if (!browserContents) {
                return {
                  ok: false,
                  rect: null,
                  viewBounds: null,
                  screenPoint: null,
                  paintedPixelSamples: 0,
                  urls: allContents.map((item) => item.getURL())
                }
              }
              const ownerWindow = BrowserWindow.getAllWindows().find((candidate) =>
                candidate.contentView.children.some(
                  (child) =>
                    child instanceof WebContentsView && child.webContents.id === browserContents.id
                )
              )
              const browserView = ownerWindow?.contentView.children.find(
                (child) =>
                  child instanceof WebContentsView && child.webContents.id === browserContents.id
              )
              const rect = await browserContents.executeJavaScript(`(() => {
                const button = document.querySelector('#complete-manual')
                if (!(button instanceof HTMLElement)) return null
                const bounds = button.getBoundingClientRect()
                return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
              })()`)
              if (!ownerWindow || !(browserView instanceof WebContentsView) || !rect) {
                return {
                  ok: false,
                  rect,
                  viewBounds: null,
                  screenPoint: null,
                  paintedPixelSamples: 0,
                  urls: allContents.map((item) => item.getURL())
                }
              }
              const image = await browserContents.capturePage()
              const bitmap = image.toBitmap()
              let paintedPixelSamples = 0
              for (let offset = 0; offset < bitmap.length; offset += 4 * 64) {
                if (bitmap[offset] < 245 || bitmap[offset + 1] < 245 || bitmap[offset + 2] < 245) {
                  paintedPixelSamples += 1
                }
              }
              const contentBounds = ownerWindow.getContentBounds()
              const viewBounds = browserView.getBounds()
              const dipPoint = {
                x: contentBounds.x + viewBounds.x + rect.x + rect.width / 2,
                y: contentBounds.y + viewBounds.y + rect.y + rect.height / 2
              }
              return {
                ok:
                  browserView.getVisible() &&
                  viewBounds.width > 0 &&
                  viewBounds.height > 0 &&
                  paintedPixelSamples > 0,
                rect,
                viewBounds,
                screenPoint:
                  process.platform === 'win32' ? screen.dipToScreenPoint(dipPoint) : dipPoint,
                paintedPixelSamples,
                urls: []
              }
            },
            { url: server.url }
          )
          if (!browserTarget.ok || !browserTarget.rect || !browserTarget.screenPoint) {
            throw new Error(
              `embedded browser target is not ready: ${JSON.stringify(browserTarget)}`
            )
          }
          await page.bringToFront()
          await clickScreenPoint(browserTarget.screenPoint.x, browserTarget.screenPoint.y)
          let browserActionResult = ''
          const browserActionDeadline = Date.now() + 5_000
          while (Date.now() < browserActionDeadline) {
            browserActionResult = await runtime.electronApp.evaluate(
              async ({ webContents }, input) => {
                const browserContents = webContents
                  .getAllWebContents()
                  .find((item) => item.getURL().startsWith(input.url))
                if (!browserContents) return ''
                return String(
                  await browserContents.executeJavaScript(
                    "document.querySelector('#manual-result')?.textContent || ''"
                  )
                )
              },
              { url: server.url }
            )
            if (browserActionResult === COMPLETION_TEXT) break
            await page.waitForTimeout(100)
          }

          await getWorkbenchLocator(page, workbenchSelectors.userTakeoverConfirmButton).click()
          await waitForWorkbenchAiEvent(runtime, {
            name: 'user_takeover_confirmed',
            matches: (event) =>
              event.type === 'user_takeover_confirmed' && event.requestId === takeover.requestId
          })
          await takeoverPanel.waitFor({ state: 'hidden' })

          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const confirmedIndex = evidence.events.findIndex(
            (event) => event.type === 'user_takeover_confirmed'
          )
          const actionsAfterConfirmation = evidence.events
            .slice(Math.max(0, confirmedIndex + 1))
            .map(readBrowserAction)
            .filter(Boolean)
          const toolNames = evidence.events
            .filter((event) => event.type === 'tool_call_started')
            .map((event) => event.toolName)
          const signals = await runtime.collectSignals()

          return {
            panelMessage,
            takeoverMessage: takeover.message,
            composerHidden,
            browserActionResult,
            browserTarget,
            actionsAfterConfirmation,
            toolNames,
            finalAnswerText: evidence.finalAnswerText,
            confirmIpcCalled: signals.ipcInvokeEntries.some(
              (entry) => entry.name === 'aiRunUserTakeoverConfirm'
            ),
            eventTypes: evidence.events.map((event) => event.type)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.takeoverMessage === TAKEOVER_MESSAGE &&
              result.panelMessage === TAKEOVER_MESSAGE &&
              result.panelMessage.length <= 30 &&
              result.composerHidden &&
              result.browserActionResult === COMPLETION_TEXT &&
              result.toolNames.includes('wait_for_user_takeover') &&
              result.actionsAfterConfirmation[0] === 'observe' &&
              result.actionsAfterConfirmation.includes('extract') &&
              result.finalAnswerText.includes(COMPLETION_TEXT) &&
              result.confirmIpcCalled &&
              result.eventTypes.includes('user_takeover_required') &&
              result.eventTypes.includes('user_takeover_confirmed'),
            {
              name: 'workbench-user-takeover-real-flow',
              message:
                '真实 AI 应调用接手工具并暂停；用户在右侧浏览器操作并确认后，AI 应先 observe 再 extract，并完成最终回答。',
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

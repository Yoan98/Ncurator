import { describe, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-navigate-error-page'
const PAGE_TOKEN = 'SCHEME_FALLBACK_OK'
const E2E_LLM_CONFIG = {
  id: 'e2e-browser-navigate',
  name: 'e2e-browser-navigate',
  providerKind: 'openai-compatible' as const,
  base_url: 'http://127.0.0.1',
  api_key: 'e2e',
  model_name: 'e2e'
}

type EmbeddedSnapshot = {
  id: number
  url: string
  title: string
  bodyText: string
}

type BrowserUseRunResult = {
  action?: string
  tabId?: string
  error?: string
  page?: { url?: string; title?: string }
  result?: { path?: string }
}

const delayReadyHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title></title></head>
  <body>
    <script>
      setTimeout(() => {
        document.title = ${JSON.stringify(PAGE_TOKEN)}
        document.body.innerHTML = ${JSON.stringify(`<main>${PAGE_TOKEN}<input aria-label="query" /></main>`)}
      }, 1500)
    </script>
  </body>
</html>`

const isErrorPage = (snapshot: EmbeddedSnapshot | null, code?: string): boolean => {
  if (!snapshot) return false
  const text = `${snapshot.title} ${snapshot.bodyText}`
  if (!snapshot.title.includes('无法访问此站点')) return false
  if (!snapshot.bodyText.includes('无法加载')) return false
  if (!snapshot.bodyText.includes('重新加载')) return false
  if (code) return snapshot.bodyText.includes(code)
  return /ERR_[A-Z0-9_]+/u.test(snapshot.bodyText)
}

describe('workbench browser navigate e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description:
          '本地页验证输入什么协议就打开什么：裸主机只补 https 失败不改 http，明确 http 能打开，明确 https 失败停在馆长统一错误页并展示 Chromium 错误码，加载中可见地址栏底线，AI navigate 成功/失败都带回 tabId。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(delayReadyHtml)
          runtime.registerResource({
            name: 'browser-navigate-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          const parsed = new URL(server.url)
          const bareHost = `${parsed.hostname}:${parsed.port}${parsed.pathname}`
          const httpUrl = server.url
          const httpsFailUrl = 'https://no-such-ncurator-host.invalid/task'

          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: '浏览器错误页',
            configureModel: false
          })

          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await page.waitForFunction((testId) => {
            const shell = document.querySelector(`[data-testid="${testId}"]`)
            return shell instanceof HTMLElement && shell.getBoundingClientRect().width > 100
          }, workbenchSelectors.contentPanelShell)

          await selectWorkbenchResourceMenuItem(runtime, 'browser')
          const browserTab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-browser-"]`)
            .last()
          await browserTab.waitFor({ state: 'visible' })
          const browserTabTestId = await browserTab.getAttribute('data-testid')
          const browserTabId = browserTabTestId?.split('-browser-').at(-1) || ''
          if (!browserTabId) throw new Error('browser tab id is missing')

          const browserPanel = getWorkbenchLocator(page, workbenchSelectors.browserPanel)
          const addressInput = browserPanel.getByRole('textbox', { name: /浏览器地址/u })
          const progress = browserPanel.locator(`[data-testid="${workbenchSelectors.browserProgress}"]`)

          const readTabState = async () => {
            return await page.evaluate(async (tabId) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success ? response.state || null : null
            }, browserTabId)
          }

          const inspectEmbedded = async (): Promise<EmbeddedSnapshot | null> => {
            return await runtime.electronApp.evaluate(async ({ webContents }) => {
              const contents = webContents.getAllWebContents().find((candidate) => {
                if (candidate.isDestroyed()) return false
                const url = candidate.getURL()
                const title = candidate.getTitle()
                return (
                  url.includes('127.0.0.1') ||
                  url.startsWith('chrome-error://') ||
                  title.includes('无法访问此站点')
                )
              })
              if (!contents) return null
              let bodyText = ''
              try {
                bodyText = (await contents.executeJavaScript(
                  `((document.body && document.body.innerText) || '').slice(0, 800)`
                )) as string
              } catch {
                bodyText = ''
              }
              return {
                id: contents.id,
                url: contents.getURL(),
                title: contents.getTitle(),
                bodyText
              }
            })
          }

          const waitForProgress = async (timeoutMs: number): Promise<boolean> => {
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
              const visible = await progress
                .evaluate((element) => {
                  if (!(element instanceof HTMLElement)) return false
                  return (
                    Number.parseFloat(element.style.opacity || '0') > 0 &&
                    element.getBoundingClientRect().width > 2
                  )
                })
                .catch(() => false)
              if (visible) return true
              await page.waitForTimeout(50)
            }
            return false
          }

          const waitForProgressGone = async (timeoutMs: number): Promise<void> => {
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
              const hidden = await progress
                .evaluate((element) => {
                  if (!(element instanceof HTMLElement)) return true
                  return Number.parseFloat(element.style.opacity || '0') === 0
                })
                .catch(() => true)
              if (hidden) return
              await page.waitForTimeout(50)
            }
            throw new Error('address bar progress line stayed visible after the error page')
          }

          const waitForSnapshot = async (
            predicate: (state: Awaited<ReturnType<typeof readTabState>>, snapshot: EmbeddedSnapshot | null) => boolean,
            timeoutMs: number,
            label: string
          ): Promise<{ state: Awaited<ReturnType<typeof readTabState>>; snapshot: EmbeddedSnapshot | null }> => {
            const deadline = Date.now() + timeoutMs
            let state = await readTabState()
            let snapshot = await inspectEmbedded()
            while (Date.now() < deadline) {
              if (predicate(state, snapshot)) return { state, snapshot }
              await page.waitForTimeout(300)
              state = await readTabState()
              snapshot = await inspectEmbedded()
            }
            throw new Error(
              `${label}: url=${state?.url || snapshot?.url || '(empty)'} title=${snapshot?.title || ''} body=${(snapshot?.bodyText || '').slice(0, 200)}`
            )
          }

          await addressInput.fill(bareHost)
          await addressInput.press('Enter')
          const bare = await waitForSnapshot(
            (state, snapshot) =>
              Boolean(state?.url.startsWith('https://')) &&
              !String(state?.url || '').includes('chrome-error://') &&
              isErrorPage(snapshot),
            20_000,
            'bare host should stay https and show the embedded error page'
          )
          await waitForProgressGone(4_000)
          runtime.signal({
            name: 'browser-navigate-bare-https-error',
            message: '裸主机只补 https，失败不改 http，停在馆长错误页',
            data: { url: bare.state?.url, title: bare.snapshot?.title }
          })

          await addressInput.fill(httpUrl)
          await addressInput.press('Enter')
          const sawProgress = await waitForProgress(8_000)
          if (!sawProgress) {
            throw new Error('address bar progress line did not appear while loading http')
          }
          const httpReady = await waitForSnapshot(
            (state, snapshot) =>
              Boolean(state?.url.startsWith('http://')) &&
              Boolean(
                snapshot &&
                  (snapshot.title.includes(PAGE_TOKEN) || snapshot.bodyText.includes(PAGE_TOKEN))
              ),
            20_000,
            'explicit http should open the local page token'
          )
          runtime.signal({
            name: 'browser-navigate-explicit-http',
            message: '明确 http 打开本地页并出现口令',
            data: { url: httpReady.state?.url, title: httpReady.snapshot?.title, sawProgress }
          })

          const ownerId = httpReady.state?.ownerId
          const runBrowser = async (payload: Record<string, unknown>): Promise<BrowserUseRunResult> => {
            return (await runtime.electronApp.evaluate(
              async (_electron, input) => {
                const run = (
                  globalThis as typeof globalThis & {
                    __NCURATOR_E2E_BROWSER_USE_RUN__?: (value: unknown) => Promise<unknown>
                  }
                ).__NCURATOR_E2E_BROWSER_USE_RUN__
                if (!run) throw new Error('e2e browser run hook missing')
                return await run(input)
              },
              payload
            )) as BrowserUseRunResult
          }
          const runNavigate = async (url: string, tabId: string): Promise<BrowserUseRunResult> =>
            runBrowser({
              action: 'navigate',
              ownerId,
              tabId,
              url,
              llmConfig: E2E_LLM_CONFIG
            })

          const aiSuccess = await runNavigate(httpUrl, browserTabId)
          if (aiSuccess.error) {
            throw new Error(`AI navigate explicit http failed: ${aiSuccess.error}`)
          }
          if (aiSuccess.tabId !== browserTabId) {
            throw new Error(`AI navigate returned unexpected tabId ${aiSuccess.tabId || '(empty)'}`)
          }
          if (!String(aiSuccess.page?.url || '').startsWith('http://')) {
            throw new Error(`AI navigate final url was ${aiSuccess.page?.url || '(empty)'}`)
          }
          if (aiSuccess.page?.title !== PAGE_TOKEN) {
            throw new Error(`AI navigate title was ${aiSuccess.page?.title || '(empty)'}`)
          }
          runtime.signal({
            name: 'browser-navigate-ai-http',
            message: 'AI navigate 明确 http 成功',
            data: { tabId: aiSuccess.tabId, url: aiSuccess.page?.url }
          })

          const screenshotPath = path.join(runtime.userDataDir, 'cdp-bridge-screenshot.png')
          const screenshot = await runBrowser({
            action: 'screenshot',
            tabId: browserTabId,
            screenshotPath,
            llmConfig: E2E_LLM_CONFIG
          })
          const writtenScreenshot = screenshot.result?.path || screenshotPath
          if (screenshot.error) {
            throw new Error(`on-demand CDP screenshot failed: ${screenshot.error}`)
          }
          if (!existsSync(writtenScreenshot)) {
            throw new Error(`CDP screenshot did not write ${writtenScreenshot}`)
          }
          runtime.signal({
            name: 'browser-cdp-bridge-screenshot',
            message: '按 Tab 挂本机 CDP 桥后截图成功',
            data: { tabId: screenshot.tabId || browserTabId, path: writtenScreenshot }
          })

          const aiHttpsFail = await runNavigate(httpsFailUrl, browserTabId)
          if (!aiHttpsFail.error) {
            throw new Error('explicit https navigate should fail')
          }
          if (!aiHttpsFail.error.includes('ERR_') || aiHttpsFail.error.includes('可改试 http')) {
            throw new Error(`explicit https error was ${aiHttpsFail.error}`)
          }
          if (aiHttpsFail.tabId !== browserTabId) {
            throw new Error('failed navigate did not return the existing tabId')
          }
          const httpsError = await waitForSnapshot(
            (state, snapshot) =>
              Boolean(state?.url.startsWith('https://')) &&
              !String(state?.url || '').includes('chrome-error://') &&
              isErrorPage(snapshot),
            20_000,
            'explicit https should stay https and show the embedded error page'
          )
          await waitForProgressGone(4_000)
          runtime.signal({
            name: 'browser-navigate-https-error',
            message: '明确 https 停在系统错误页并返回 tabId',
            data: {
              tabId: aiHttpsFail.tabId,
              error: aiHttpsFail.error,
              address: httpsError.state?.url,
              pageUrl: httpsError.snapshot?.url
            }
          })

          return {
            bareUrl: String(bare.state?.url || ''),
            userUrl: String(httpReady.state?.url || ''),
            aiUrl: String(aiSuccess.page?.url || ''),
            failError: aiHttpsFail.error,
            failTabId: aiHttpsFail.tabId || '',
            failAddress: String(httpsError.state?.url || ''),
            sawProgress,
            screenshotPath: writtenScreenshot,
            errorText: `${httpsError.snapshot?.title || ''} ${httpsError.snapshot?.bodyText || ''}`
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.bareUrl.startsWith('https://') &&
              !result.bareUrl.includes('chrome-error://') &&
              result.userUrl.startsWith('http://') &&
              result.aiUrl.startsWith('http://') &&
              result.failError.includes('ERR_') &&
              !result.failError.includes('可改试 http') &&
              result.failTabId.length > 0 &&
              result.failAddress.startsWith('https://') &&
              !result.failAddress.includes('chrome-error://') &&
              result.sawProgress &&
              existsSync(result.screenshotPath) &&
              result.errorText.includes('无法访问此站点') &&
              result.errorText.includes('无法加载') &&
              /ERR_[A-Z0-9_]+/u.test(result.errorText),
            {
              name: 'browser-navigate-error-page',
              message: '裸主机不降级、明确 http 可打开、进度线、按需 CDP 截图，以及 https 失败展示 Chromium 错误码',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 4
  )
})

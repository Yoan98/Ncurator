import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-navigate-scheme-fallback'
const PAGE_TOKEN = 'SCHEME_FALLBACK_OK'
const E2E_LLM_CONFIG = {
  id: 'e2e-browser-navigate',
  name: 'e2e-browser-navigate',
  providerKind: 'custom' as const,
  base_url: 'http://127.0.0.1',
  api_key: 'e2e',
  model_name: 'e2e'
}

type EmbeddedSnapshot = {
  id: number
  url: string
  title: string
  bodyText: string
  darkRatio: number
  whiteRatio: number
}

type BrowserUseNavigateResult = {
  action?: string
  tabId?: string
  error?: string
  fallback?: string
  page?: { url?: string; title?: string }
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
          '本地 HTTP 页验证未写协议时 https 回退 http、明确 https 停在系统错误页，以及 AI navigate 成功/失败都带回 tabId。',
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
          const httpsFailUrl = `https://${parsed.hostname}:1${parsed.pathname}`

          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: '浏览器协议回退',
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

          const readTabState = async () => {
            return await page.evaluate(async (tabId) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success ? response.state || null : null
            }, browserTabId)
          }

          const inspectEmbedded = async (contentsId?: number): Promise<EmbeddedSnapshot | null> => {
            return await runtime.electronApp.evaluate(
              async ({ webContents }, payload) => {
                const all = webContents.getAllWebContents().filter((candidate) => !candidate.isDestroyed())
                const contents =
                  typeof payload.contentsId === 'number'
                    ? all.find((candidate) => candidate.id === payload.contentsId)
                    : all.find(
                        (candidate) =>
                          candidate.getURL().startsWith(payload.httpUrl) ||
                          candidate.getURL() === payload.httpsUrl ||
                          candidate.getURL().startsWith('chrome-error://')
                      )
                if (!contents) return null
                let bodyText = ''
                try {
                  bodyText = (await contents.executeJavaScript(
                    `((document.body && document.body.innerText) || '').slice(0, 800)`
                  )) as string
                } catch {
                  bodyText = ''
                }
                let darkRatio = 0
                let whiteRatio = 1
                try {
                  const image = await contents.capturePage()
                  const size = image.getSize()
                  const bitmap = image.toBitmap()
                  let sampled = 0
                  let white = 0
                  let dark = 0
                  for (let y = 0; y < size.height; y += 3) {
                    for (let x = 0; x < size.width; x += 3) {
                      const offset = (y * size.width + x) * 4
                      const blue = bitmap[offset]
                      const green = bitmap[offset + 1]
                      const red = bitmap[offset + 2]
                      sampled += 1
                      if (red > 245 && green > 245 && blue > 245) white += 1
                      if (red < 80 && green < 100 && blue < 120) dark += 1
                    }
                  }
                  whiteRatio = sampled > 0 ? white / sampled : 1
                  darkRatio = sampled > 0 ? dark / sampled : 0
                } catch {
                  darkRatio = 0
                  whiteRatio = 1
                }
                return {
                  id: contents.id,
                  url: contents.getURL(),
                  title: contents.getTitle(),
                  bodyText,
                  darkRatio,
                  whiteRatio
                }
              },
              { contentsId, httpUrl: server.url, httpsUrl: httpsFailUrl }
            )
          }

          await addressInput.fill(bareHost)
          await addressInput.press('Enter')
          const userFallbackDeadline = Date.now() + 35_000
          let userSnapshot: EmbeddedSnapshot | null = null
          while (Date.now() < userFallbackDeadline) {
            const state = await readTabState()
            const snapshot = await inspectEmbedded()
            if (
              state?.url.startsWith('http://') &&
              snapshot &&
              (snapshot.title.includes(PAGE_TOKEN) || snapshot.bodyText.includes(PAGE_TOKEN))
            ) {
              userSnapshot = snapshot
              break
            }
            await page.waitForTimeout(300)
          }
          if (!userSnapshot) {
            throw new Error('address bar did not fall back from https to http with page token')
          }
          const userState = await readTabState()
          if (!userState?.url.startsWith('http://') || userState.url.includes('chrome-error://')) {
            throw new Error(`address bar url after fallback was ${userState?.url || '(empty)'}`)
          }
          runtime.signal({
            name: 'browser-navigate-user-fallback',
            message: '地址栏裸主机已回退到 http 并出现口令',
            data: { url: userState.url, title: userSnapshot.title }
          })

          const ownerId = userState.ownerId
          const runNavigate = async (url: string, tabId: string): Promise<BrowserUseNavigateResult> => {
            return (await runtime.electronApp.evaluate(
              async (_electron, payload) => {
                const run = (
                  globalThis as typeof globalThis & {
                    __NCURATOR_E2E_BROWSER_USE_RUN__?: (input: unknown) => Promise<unknown>
                  }
                ).__NCURATOR_E2E_BROWSER_USE_RUN__
                if (!run) throw new Error('e2e browser run hook missing')
                return await run(payload)
              },
              {
                action: 'navigate',
                ownerId,
                tabId,
                url,
                llmConfig: E2E_LLM_CONFIG
              }
            )) as BrowserUseNavigateResult
          }

          const aiSuccess = await runNavigate(bareHost, browserTabId)
          if (aiSuccess.error) {
            throw new Error(`AI navigate bare host failed: ${aiSuccess.error}`)
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
          if (aiSuccess.fallback !== 'https-to-http') {
            throw new Error(`AI navigate missing https-to-http fallback, got ${aiSuccess.fallback || '(none)'}`)
          }
          runtime.signal({
            name: 'browser-navigate-ai-fallback',
            message: 'AI navigate 裸主机回退 http 成功',
            data: { tabId: aiSuccess.tabId, url: aiSuccess.page?.url, fallback: aiSuccess.fallback }
          })

          const aiHttpsFail = await runNavigate(httpsFailUrl, browserTabId)
          if (!aiHttpsFail.error) {
            throw new Error('explicit https navigate should fail')
          }
          if (!aiHttpsFail.error.includes('ERR_') || !aiHttpsFail.error.includes('可改试 http')) {
            throw new Error(`explicit https error was ${aiHttpsFail.error}`)
          }
          if (aiHttpsFail.tabId !== browserTabId) {
            throw new Error('failed navigate did not return the existing tabId')
          }
          const failState = await readTabState()
          if (!failState?.url.startsWith('https://') || failState.url.includes('chrome-error://')) {
            throw new Error(`address bar after https failure was ${failState?.url || '(empty)'}`)
          }
          const errorDeadline = Date.now() + 8_000
          let errorSnapshot: EmbeddedSnapshot | null = null
          while (Date.now() < errorDeadline) {
            const snapshot = await inspectEmbedded(userSnapshot.id)
            const errorText = `${snapshot?.title || ''} ${snapshot?.bodyText || ''}`
            if (
              snapshot &&
              (snapshot.url.startsWith('chrome-error://') ||
                /无法访问|ERR_|can.?t be reached|took too long to respond/iu.test(errorText) ||
                (snapshot.url.startsWith('https://') &&
                  snapshot.darkRatio > 0.006 &&
                  !snapshot.bodyText.includes(PAGE_TOKEN)))
            ) {
              errorSnapshot = snapshot
              break
            }
            await page.waitForTimeout(300)
          }
          if (!errorSnapshot) {
            const last = await inspectEmbedded(userSnapshot.id)
            throw new Error(
              `expected Chromium error page, got url=${last?.url || '(none)'} title=${last?.title || ''} body=${(last?.bodyText || '').slice(0, 200)} dark=${String(last?.darkRatio ?? 0)} white=${String(last?.whiteRatio ?? 1)}`
            )
          }
          runtime.signal({
            name: 'browser-navigate-https-error',
            message: '明确 https 停在系统错误页并返回 tabId',
            data: {
              tabId: aiHttpsFail.tabId,
              error: aiHttpsFail.error,
              address: failState.url,
              pageUrl: errorSnapshot.url
            }
          })
          return {
            userUrl: userState.url,
            aiUrl: String(aiSuccess.page?.url || ''),
            aiFallback: aiSuccess.fallback || '',
            failError: aiHttpsFail.error,
            failTabId: aiHttpsFail.tabId || '',
            failAddress: failState.url,
            errorText: `${errorSnapshot.title} ${errorSnapshot.bodyText}`
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.userUrl.startsWith('http://') &&
              result.aiUrl.startsWith('http://') &&
              result.aiFallback === 'https-to-http' &&
              result.failError.includes('ERR_') &&
              result.failError.includes('可改试 http') &&
              result.failTabId.length > 0 &&
              result.failAddress.startsWith('https://') &&
              !result.failAddress.includes('chrome-error://') &&
              /无法访问|ERR_/u.test(result.errorText),
            {
              name: 'browser-navigate-scheme-fallback',
              message: '裸主机 https→http 回退，明确 https 失败露出错误页并返回同一 tabId',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 3
  )
})

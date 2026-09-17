import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  selectWorkbenchResourceMenuItem,
  setupWorkbenchWithTempWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'browser-navigate-cnipa-https'
const TARGET_HOST = 'epub.cnipa.gov.cn'
const TARGET_URL = `https://${TARGET_HOST}/`
const PAGE_TOKEN = '中国专利公布公告'

describe('workbench browser cnipa e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['browser'],
        description:
          '公网专利公布公告明确 https 不改 http；打不开或超时时停在馆长统一错误页，而不是白屏。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceName: '专利公布 https',
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
          await addressInput.fill(TARGET_URL)
          await addressInput.press('Enter')

          const progress = browserPanel.locator(`[data-testid="${workbenchSelectors.browserProgress}"]`)
          const progressDeadline = Date.now() + 12_000
          let sawProgress = false
          while (Date.now() < progressDeadline) {
            const visible = await progress
              .evaluate((element) => {
                if (!(element instanceof HTMLElement)) return false
                return (
                  Number.parseFloat(element.style.opacity || '0') > 0 &&
                  element.getBoundingClientRect().width > 2
                )
              })
              .catch(() => false)
            if (visible) {
              sawProgress = true
              break
            }
            await page.waitForTimeout(50)
          }
          if (!sawProgress) {
            throw new Error('address bar progress line did not appear while loading CNIPA https')
          }

          const deadline = Date.now() + 90_000
          let finalUrl = ''
          let title = ''
          let bodyText = ''
          while (Date.now() < deadline) {
            const state = await page.evaluate(async (tabId) => {
              const response = await window.api.browserPanelStateGet({ tabId })
              return response.success ? response.state || null : null
            }, browserTabId)
            const snapshot = await runtime.electronApp.evaluate(async ({ webContents }) => {
              const contents = webContents
                .getAllWebContents()
                .find(
                  (candidate) =>
                    !candidate.isDestroyed() &&
                    (candidate.getURL().includes('epub.cnipa.gov.cn') ||
                      candidate.getTitle().includes('无法访问此站点'))
                )
              if (!contents) return null
              let text = ''
              try {
                text = (await contents.executeJavaScript(
                  `((document.body && document.body.innerText) || '').slice(0, 800)`
                )) as string
              } catch {
                text = ''
              }
              return {
                url: contents.getURL(),
                title: contents.getTitle(),
                bodyText: text
              }
            })
            finalUrl = snapshot?.url || state?.url || ''
            title = snapshot?.title || ''
            bodyText = snapshot?.bodyText || ''
            const visible = `${title} ${bodyText}`
            const stayedHttps =
              finalUrl.startsWith('https://') &&
              finalUrl.includes(TARGET_HOST) &&
              !finalUrl.includes('chrome-error://')
            const isErrorPage =
              visible.includes('无法访问此站点') && /ERR_[A-Z0-9_]+/u.test(visible)
            const isHomepage = visible.includes(PAGE_TOKEN)
            if (stayedHttps && (isErrorPage || isHomepage)) {
              runtime.signal({
                name: 'browser-navigate-cnipa-https',
                message: isErrorPage
                  ? '专利公布公告 https 停在馆长错误页，没有改成 http'
                  : '专利公布公告 https 打开了首页，没有改成 http',
                data: { url: finalUrl, title, sawProgress, isErrorPage, isHomepage }
              })
              return {
                url: finalUrl,
                title,
                bodyText,
                sawProgress,
                isErrorPage,
                isHomepage
              }
            }
            await page.waitForTimeout(400)
          }
          throw new Error(
            `CNIPA https did not settle on error page or homepage, url=${finalUrl || '(empty)'} title=${title} body=${bodyText.slice(0, 180)}`
          )
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.url.startsWith(`https://${TARGET_HOST}`) &&
              result.sawProgress &&
              !result.url.includes('chrome-error://') &&
              (result.isErrorPage || result.isHomepage),
            {
              name: 'browser-navigate-cnipa-https',
              message: '明确 https 打开专利公布公告时不降级 http，失败或超时画出错误页',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS * 4
  )
})

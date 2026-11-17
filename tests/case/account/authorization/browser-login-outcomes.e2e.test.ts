import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { chromium } from 'playwright'
import {
  deliverDesktopAuthorization,
  labels,
  menuItem,
  newTestEmail,
  openAccountMenu,
  openDesktopAuthorization,
  readDesktopUserNo,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase, type E2ETestRuntime } from '../../../harness/e2e/run-e2e-case'

const execFileAsync = promisify(execFile)

async function prepareWindowsCallback(
  runtime: E2ETestRuntime,
  extraEnv: Record<string, string>
) {
  const installed = await runtime.electronApp.evaluate(({ app }) => ({
    executable: app.getPath('exe'),
    registered: app.isDefaultProtocolClient('ncurator'),
    hasLock: app.requestSingleInstanceLock()
  }))
  expect(installed.registered).toBe(true)
  expect(installed.hasLock).toBe(true)
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Item -LiteralPath 'HKCU:\\Software\\Classes\\ncurator\\shell\\open\\command').GetValue('')"
    ],
    { windowsHide: true, timeout: 10_000 }
  )
  expect(stdout.trim()).toBe(`"${installed.executable}" "%1"`)

  return async (callback: URL) => {
    // Run the registered command with the test profile and deny proxy so Electron
    // forwards the URL through its Windows single-instance handling.
    const env = { ...process.env, ...extraEnv, NCURATOR_USER_DATA_PATH: runtime.userDataDir }
    for (const key of Object.keys(env)) {
      if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NCURATOR_E2E_OBSERVER'].includes(key.toUpperCase())) {
        delete env[key]
      }
    }
    await execFileAsync(installed.executable, [callback.href], {
      env,
      cwd: dirname(installed.executable),
      windowsHide: true,
      timeout: 10_000
    }).catch(() => {
      throw new Error('The registered Windows protocol process did not exit cleanly')
    })
  }
}

it('browser-login-outcomes', async () => {
  if (process.env.NCURATOR_E2E_LOCAL_BACKEND === '1') {
    if (process.env.NCURATOR_SERVICE_ENV !== 'local') throw new Error('Local backend E2E requires NCURATOR_SERVICE_ENV=local')
    const api = requiredLoopback(process.env.NCURATOR_LOCAL_API_ORIGIN)
    const web = requiredLoopback(process.env.NCURATOR_LOCAL_WEB_ORIGIN)
    await runE2ECase({
      caseId: 'browser-login-outcomes',
      domain: 'account',
      suite: 'authorization',
      description: '从真实桌面启动本地授权，验证网页和桌面都使用同一套本地 API。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.electronApp.evaluate(({ shell }) => {
          shell.openExternal = async (url: string) => {
            Object.assign(globalThis, { localAuthorizationTarget: url })
          }
        })
        await openAccountMenu(runtime.page)
        await menuItem(runtime.page, labels.login).click()
        const target = () => runtime.electronApp.evaluate(() =>
          (globalThis as typeof globalThis & { localAuthorizationTarget?: string }).localAuthorizationTarget ?? ''
        )
        await expect.poll(target).toContain(web + '/desktop/authorize#')
        const url = new URL(await target())
        expect(url.origin).toBe(web)
        expect(url.pathname).toBe('/desktop/authorize')
        expect([...new URLSearchParams(url.hash.slice(1)).keys()].sort()).toEqual(['flow', 'state'])

        const browser = await chromium.launch({ channel: process.env.NCURATOR_E2E_BROWSER_CHANNEL || 'chrome' })
        try {
          const page = await browser.newPage()
          const [sessionResponse, pageResponse] = await Promise.all([
            page.waitForResponse(response => response.url() === api + '/api/auth/session'),
            page.goto(url.href)
          ])
          expect(pageResponse?.status()).toBe(200)
          expect(sessionResponse.status()).toBe(401)
        } finally {
          await browser.close()
        }
        return { origin: url.origin }
      },
      assert: async ({ origin }, runtime) => runtime.assertThat(origin === web, {
        name: 'local-backend-browser-authorization',
        message: '桌面授权和浏览器会话使用同一套本地后端'
      })
    })
    return
  }
  await withAccountFixture(async (setup, service) => {
    await runE2ECase({
      ...setup,
      caseId: 'browser-login-outcomes',
      domain: 'account',
      suite: 'authorization',
      description: '在真实界面验证取消、过期、错误 state 和重复授权回跳。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const windowsProtocol =
          process.platform === 'win32' && process.env.NCURATOR_E2E_APP_TARGET === 'package'
        const deliverValidCallback = windowsProtocol
          ? await prepareWindowsCallback(runtime, setup.extraEnv)
          : (link: URL) => deliverDesktopAuthorization(runtime, link)
        const email = newTestEmail('callback')
        const activeDesktops = async () =>
          (await service.evidence(email)).sessions.filter(
            (session) => session.clientType === 'desktop' && !session.revokedReason
          ).length
        const waitSignedOut = async () => {
          await openAccountMenu(page)
          await menuItem(page, labels.login).waitFor()
          expect(await readDesktopUserNo(page)).toBeUndefined()
          expect(await activeDesktops()).toBe(0)
        }

        let web = await service.browserPage()
        const cancelledFlow = await openDesktopAuthorization(runtime)
        await service.signIn(web, email, cancelledFlow.href)
        const cancelledCallback = await service.approveDesktop(web)
        await openAccountMenu(page)
        await menuItem(page, /^取消登录$/u).click()
        await deliverDesktopAuthorization(runtime, cancelledCallback)
        await waitSignedOut()

        web = await service.continueInBrowser(web)
        const expiringFlow = await openDesktopAuthorization(runtime)
        await web.goto(expiringFlow.href)
        const expired = await service.approveDesktop(web)
        await web.getByText(/本次授权已过期/u).waitFor({ timeout: 75_000 })
        await deliverDesktopAuthorization(runtime, expired)
        await waitSignedOut()

        web = await service.continueInBrowser(web)
        const validFlow = await openDesktopAuthorization(runtime)
        await web.goto(validFlow.href)
        const valid = await service.approveDesktop(web)
        const wrongState = new URL(valid)
        wrongState.searchParams.set(
          'state',
          new URLSearchParams(cancelledFlow.hash.slice(1)).get('state')!
        )
        await deliverDesktopAuthorization(runtime, wrongState)
        await openAccountMenu(page)
        await menuItem(page, /^取消登录$/u).waitFor()
        expect(await readDesktopUserNo(page)).toBeUndefined()
        expect(await activeDesktops()).toBe(0)

        await deliverValidCallback(valid)
        await web.getByRole('heading', { name: '登录成功', exact: true }).waitFor()
        await deliverDesktopAuthorization(runtime, valid)
        await deliverDesktopAuthorization(runtime, cancelledCallback)
        web = await service.continueInBrowser(web)
        const owner = await service.userNumber(web)
        await expect.poll(() => readDesktopUserNo(page)).toBe(owner)
        const activeSessions = await activeDesktops()
        expect(activeSessions).toBe(1)
        return { activeSessions, windowsProtocol }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.activeSessions === 1, {
          name: 'desktop-callback-with-one-session',
          message: '取消、过期、错误及重复回跳不会创建额外桌面会话',
          data: result
        })
    })
  })
}, 160_000)

function requiredLoopback(value?: string) {
  const url = new URL(value ?? '')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || value !== url.origin) {
    throw new Error('Start the local backend and load its client environment before the test')
  }
  return url.origin
}

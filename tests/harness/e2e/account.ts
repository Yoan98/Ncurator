import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect } from 'vitest'
import { launchElectronApp } from './electronApp'
import type { E2ETestRuntime } from './run-e2e-case'

const site = 'https://www.guanzhangai.cn'
const api = 'https://api.guanzhangai.cn'

const sourceBootstrap = String.raw`
const { app, session, shell } = require('electron')
const settings = JSON.parse(process.env.NCURATOR_ACCOUNT_TEST_INPUT)
const origin = new URL(settings.api)
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('Expected a local test API')
const fetchNetwork = globalThis.fetch
const network = { walletReads: 0, blockWallet: false, urls: [] }
globalThis.__accountTestNetwork = network
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== 'https://api.guanzhangai.cn' || !url.pathname.startsWith('/api/auth/desktop/')) {
    return Response.json({ error: 'isolated_test' }, { status: 503 })
  }
  const wallet = url.pathname === '/api/auth/desktop/wallet'
  if (wallet) {
    network.walletReads++
    if (network.blockWallet) throw new Error('Isolated wallet transport interruption')
  }
  return fetchNetwork(new URL(url.pathname + url.search, origin), {
    method: request.method, headers: request.headers, signal: request.signal, redirect: 'error',
    ...(request.body && { body: await request.arrayBuffer() })
  })
}
shell.openExternal = async (target) => {
  const url = new URL(target)
  if (url.origin !== 'https://www.guanzhangai.cn' ||
      !['/desktop/authorize', '/account/recharge', '/account/billing', '/zh/contact', '/en/contact'].includes(url.pathname)) {
    throw new Error('Unexpected external address')
  }
  network.urls.push(url.href)
}
app.on('ready', () => session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })
))
require(settings.main)
`

type Fixture = { api: string; control: string; appKey: string; browserArgs: string[] }
type Transport = {
  walletReads: number
  blockWallet: boolean
  urls: string[]
}
type AccountRuntime = typeof globalThis & { __accountTestNetwork: Transport }

export const labels = {
  login: /^(?:登\s*录|Sign in)$/u,
  settings: /^(?:设置|Settings)$/u,
  help: /^(?:查看使用帮助|View help)$/u,
  balance: /可用余额|Available balance/u,
  recharge: /^(?:充\s*值|Top up)$/u,
  billing: /^(?:账\s*单|Billing)$/u,
  signOut: /^(?:退出当前桌面|Sign out of this desktop)$/u,
  copy: /^(?:复\s*制|Copy)$/u,
  refresh: /刷新余额|Refresh balance/u,
  stale: /余额待更新|Balance awaiting update/u,
  original:
    /免费、自定义模型和本地工作仍可使用|Free models, custom models, and local work are still available/u,
  refund: /退款|Refund/iu
}

export const accountPanel = (page: Page) => page.getByTestId('desktop-account-settings')
export const accountButton = (page: Page) => page.getByTestId('desktop-account-menu')
export const available = (page: Page) => page.getByTestId('desktop-account-available')
export const menuItem = (page: Page, name: RegExp) => page.getByRole('menuitem', { name })
export const settingsAccount = (page: Page) => page.locator('a[href="#/settings/account"]')
export const externalUrls = (runtime: E2ETestRuntime) =>
  runtime.electronApp.evaluate(() => [...(globalThis as AccountRuntime).__accountTestNetwork.urls])
export const walletReads = (runtime: E2ETestRuntime) =>
  runtime.electronApp.evaluate(
    () => (globalThis as AccountRuntime).__accountTestNetwork.walletReads
  )
export const setWalletOffline = (runtime: E2ETestRuntime, block: boolean) =>
  runtime.electronApp.evaluate((_electron, value) => {
    ;(globalThis as AccountRuntime).__accountTestNetwork.blockWallet = value
  }, block)
export async function readCopiedNumber(runtime: E2ETestRuntime) {
  const previous = await runtime.electronApp.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await accountPanel(runtime.page).getByRole('button', { name: labels.copy, exact: true }).click()
    await accountPanel(runtime.page)
      .getByText(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u)
      .waitFor()
    const visible = await accountPanel(runtime.page)
      .getByText(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u)
      .innerText()
    await expect
      .poll(() => runtime.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(visible)
    return visible
  } finally {
    await runtime.electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      previous
    )
  }
}

const isLoopback = (value: string) => {
  const url = new URL(value)
  return (
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value && !!url.port
  )
}
async function loadFixture(): Promise<Fixture> {
  const path = process.env.NCURATOR_ACCOUNT_E2E_FIXTURE
  if (!path) throw new Error('Configure the isolated Account E2E service using the test plan')
  const fixture = JSON.parse(await readFile(path, 'utf8')) as Fixture
  if (
    !isLoopback(fixture.api) ||
    !isLoopback(fixture.control) ||
    !/^[a-f0-9]{64}$/u.test(fixture.appKey) ||
    fixture.browserArgs.length !== 2 ||
    fixture.browserArgs[0] !== '--no-proxy-server' ||
    !/^--host-resolver-rules=(?:MAP [a-z0-9.-]+ 127\.0\.0\.1:\d+,)+MAP \* ~NOTFOUND$/u.test(
      fixture.browserArgs[1]
    )
  ) {
    throw new Error('Account E2E requires isolated loopback services')
  }
  return fixture
}

type Service = {
  browserPage: () => Promise<Page>
  continueInBrowser: (page: Page) => Promise<Page>
  signIn: (page: Page, email: string, target: string) => Promise<void>
  authorize: (runtime: E2ETestRuntime, page: Page, email: string) => Promise<void>
  userNumber: (page: Page) => Promise<string>
  recharge: (page: Page) => Promise<void>
  checkOverseas: () => Promise<void>
}

export const newTestEmail = (prefix: string) => prefix + '-' + randomUUID() + '@example.test'
export const mask = (email: string) => email[0] + '***@example.test'

export async function withAccountFixture(
  run: (
    setup: { sourceAppPath: string; extraEnv: Record<string, string> },
    service: Service
  ) => Promise<void>
) {
  const fixture = await loadFixture()
  const root = await mkdtemp(join(tmpdir(), 'ncurator-account-e2e-'))
  const extraEnv = {
    NCURATOR_ACCOUNT_TEST_INPUT: JSON.stringify({
      api: fixture.api,
      main: resolve('out/main/index.js')
    }),
    NCURATOR_APP_SECRET_DESKTOP: fixture.appKey,
    NCURATOR_DISTRIBUTION: 'domestic'
  }
  const post = (path: string, body: object) =>
    fetch(fixture.control + path, {
      method: 'POST',
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: 'Bearer ' + fixture.appKey, 'content-type': 'application/json' }
    })
  try {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'ncurator-account-test', main: 'main.cjs' })
    )
    await writeFile(join(root, 'main.cjs'), sourceBootstrap)
    const browser = await chromium.launch({
      channel: process.env.NCURATOR_E2E_BROWSER_CHANNEL,
      args: fixture.browserArgs
    })
    try {
      const service: Service = {
        async browserPage() {
          const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            serviceWorkers: 'block'
          })
          context.setDefaultTimeout(10_000)
          return context.newPage()
        },
        async continueInBrowser(page) {
          const context = page.context()
          await page.close()
          return context.newPage()
        },
        async signIn(page, email, target) {
          await page.goto(target)
          await page.waitForURL((url) => url.pathname === '/login')
          expect(new URL(page.url()).searchParams.get('returnTo')).toBe(new URL(target).pathname)
          await page.getByLabel('邮箱', { exact: true }).fill(email)
          await page.getByRole('button', { name: '获取邮箱验证码', exact: true }).click()
          await page.getByLabel('图片验证码', { exact: true }).fill('abcde')
          const [sent] = await Promise.all([
            page.waitForResponse((response) => response.url() === api + '/api/auth/email/send'),
            page.getByRole('button', { name: '发送邮箱验证码', exact: true }).click()
          ])
          expect(sent.status()).toBe(200)
          const mail = await post('/otp', { email })
          expect(mail.status).toBe(200)
          const { code } = (await mail.json()) as { code: string }
          await page.getByLabel('邮箱验证码', { exact: true }).fill(code)
          await page.getByRole('button', { name: '登录', exact: true }).click()
          await page.waitForURL((url) => url.pathname === new URL(target).pathname)
        },
        async authorize(desktop, page, email) {
          const before = (await externalUrls(desktop)).length
          await accountPanel(desktop.page).getByRole('button', { name: labels.login }).click()
          await expect.poll(async () => (await externalUrls(desktop)).length).toBe(before + 1)
          const target = new URL((await externalUrls(desktop)).at(-1)!)
          expect(target.origin + target.pathname + target.search).toBe(site + '/desktop/authorize')
          expect([...new URLSearchParams(target.hash.slice(1)).keys()].sort()).toEqual([
            'flow',
            'state'
          ])
          await service.signIn(page, email, target.href)
          const [approval] = await Promise.all([
            page.waitForResponse(
              (response) => response.url() === api + '/api/auth/desktop/approve'
            ),
            page.getByRole('button', { name: '确认登录', exact: true }).click()
          ])
          expect(approval.status()).toBe(200)
          const { callbackUrl } = (await approval.json()) as { callbackUrl: string }
          const callback = new URL(callbackUrl)
          expect(callback.protocol + '//' + callback.host + callback.pathname).toBe(
            'ncurator://auth/callback'
          )
          expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state'])
          await desktop.electronApp.evaluate(({ app }, link) => {
            app.emit('open-url', { preventDefault() {} }, link)
          }, callbackUrl)
          await page.getByRole('heading', { name: '登录成功', exact: true }).waitFor()
          await accountPanel(desktop.page).getByText(mask(email), { exact: true }).waitFor()
        },
        async userNumber(page) {
          await page.goto(site + '/account')
          await page.getByRole('heading', { name: '账户概览', exact: true }).waitFor()
          return (
            await page
              .getByText('用户编号', { exact: true })
              .locator('..')
              .locator('dd span')
              .first()
              .innerText()
          ).trim()
        },
        async recharge(page) {
          if (new URL(page.url()).pathname !== '/account/recharge')
            await page.goto(site + '/account/recharge')
          const payable = page
            .getByText('应付金额', { exact: true })
            .locator('..')
            .locator('strong')
          const attempts: string[] = []
          const request = (event: import('playwright').Request) => {
            const target = new URL(event.url())
            if (target.pathname === '/api/account/recharge-orders')
              attempts.push(event.method() + ' ' + target.origin)
          }
          const errors: string[] = []
          const error = (event: Error) => {
            errors.push(event.message.slice(0, 160))
          }
          page.on('request', request)
          page.on('pageerror', error)
          try {
            const amount = page.getByRole('textbox', { name: '自选金额' })
            await amount.fill('5')
            await expect.poll(() => payable.innerText()).toBe('¥5.00')
            const submit = page.getByRole('button', { name: '立即充值' })
            expect(
              await submit.evaluate((button: HTMLButtonElement) => button.form?.checkValidity())
            ).toBe(true)
            const requestPath = '/api/account/recharge-orders'
            const [order] = await Promise.all([
              page.waitForResponse(
                (response) =>
                  response.request().method() === 'POST' &&
                  new URL(response.url()).pathname === requestPath
              ),
              submit.click()
            ])
            expect(new URL(order.url()).origin).toBe(api)
            expect(order.status()).toBe(200)
            const { orderNo } = (await order.json()) as { orderNo: string }
            await page.getByRole('heading', { name: '微信扫码付款' }).waitFor()
            expect((await post('/pay', { orderNo })).status).toBe(200)
            await page.getByRole('link', { name: '我已支付，查看结果' }).click()
            await page.getByRole('heading', { name: '已到账' }).waitFor()
          } catch (cause) {
            throw new Error('Isolated checkout failed: ' + JSON.stringify({ attempts, errors }), {
              cause
            })
          } finally {
            page.off('request', request)
            page.off('pageerror', error)
          }
        },
        async checkOverseas() {
          const app = await launchElectronApp({
            serviceMode: 'real',
            sourceAppPath: root,
            extraEnv: { ...extraEnv, NCURATOR_DISTRIBUTION: 'international' }
          })
          try {
            await app.page.waitForFunction(() => !!window.api)
            const preferences = await app.page.evaluate(() => window.api.appSettingsGet())
            expect(preferences.serviceRoute).toBe('international')
            expect(await accountButton(app.page).count()).toBe(0)
            await app.page.getByRole('button', { name: labels.settings, exact: true }).click()
            await app.page.locator('a[href="#/settings/model"]').waitFor()
            expect(await settingsAccount(app.page).count()).toBe(0)
            expect(await accountButton(app.page).count()).toBe(0)
            expect(await accountPanel(app.page).count()).toBe(0)
            expect(
              await app.electronApp.evaluate(
                () => (globalThis as AccountRuntime).__accountTestNetwork.urls
              )
            ).toEqual([])
          } finally {
            await app.close({ tracePath: join(root, 'international-trace.zip') })
          }
        }
      }
      await run({ sourceAppPath: root, extraEnv }, service)
    } finally {
      await browser.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export async function returnToDesktop(runtime: E2ETestRuntime) {
  await runtime.page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

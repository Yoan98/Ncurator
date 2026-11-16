import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect } from 'vitest'
import { launchElectronApp } from './electronApp'
import type { E2ETestRuntime } from './run-e2e-case'
import { startNodeOneProxy } from './nodeOneAcceptance'
import { resolveLiveLlmTarget } from '../core/liveProviders'

const site = 'https://www.guanzhangai.cn'
const api = 'https://api.guanzhangai.cn'

const sourceBootstrap = String.raw`
const { app, session, shell } = require('electron')
const settings = JSON.parse(process.env.NCURATOR_ACCOUNT_TEST_INPUT)
const origin = new URL(settings.api)
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('Expected a local test API')
const fetchNetwork = globalThis.fetch
const network = { walletReads: 0, blockWallet: false, urls: [], refreshStatuses: [],
  modelPosts: [], modelLookups: [], droppedRefreshes: 0, droppedResults: 0, releasedWallets: 0,
  dropRefresh: settings.dropRefresh === true }
globalThis.__accountTestNetwork = network
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const path = url.pathname
  const modelPost = path === '/api/v2/managed/chat/completions'
  const freePost = settings.acceptance && path === '/api/v2/free/chat/completions'
  if (settings.acceptance && url.origin === settings.acceptance.proxyOrigin) {
    if (request.method === 'GET' && path === '/custom/models' && settings.acceptance.customBase)
      return fetchNetwork(settings.acceptance.customBase + '/models', {headers: request.headers, signal: request.signal, redirect: 'error'})
    if (request.method === 'GET' && path === '/custom/models') return Response.json({
      object: 'list', data: [{ id: 'gpt-6-luna', object: 'model', owned_by: 'synthetic-acceptance' }]
    })
    if (request.method === 'POST' && path === '/custom/chat/completions') return fetchNetwork(request)
    return Response.json({error: 'isolated_test'}, {status: 503})
  }
  const lookup = /^\/api\/v2\/managed\/calls\/([a-f0-9-]{36})$/.exec(path)
  if (url.origin !== 'https://api.guanzhangai.cn' || !(path.startsWith('/api/auth/desktop/') ||
    path === '/api/v1/managed-models' || modelPost || lookup || (settings.acceptance &&
      ['/api/v1/model-catalog', '/api/v1/free/token', '/api/v2/free/chat/completions'].includes(path)))) {
    return Response.json({ error: 'isolated_test' }, { status: 503 })
  }
  const wallet = path === '/api/auth/desktop/wallet'
  const holdWallet = wallet && network.holdWallet
  if (holdWallet) network.holdWallet = false
  if (wallet) {
    network.walletReads++
    if (network.blockWallet) throw new Error('Isolated wallet transport interruption')
  }
  const body = request.body ? await request.arrayBuffer() : undefined
  if (modelPost) network.modelPosts.push(JSON.parse(Buffer.from(body).toString()).requestId)
  if (lookup) network.modelLookups.push(lookup[1])
  const response = await fetchNetwork(freePost ? settings.acceptance.proxyOrigin + '/free' : new URL(path + url.search, origin), {
    method: request.method, headers: request.headers, signal: request.signal, redirect: 'error',
    ...(body && { body })
  })
  if (holdWallet && response.ok) {
    const {available, version} = await response.clone().json()
    await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer)
        network.pendingWallet = undefined
        resolve()
      }
      const timer = setTimeout(finish, 20000)
      network.pendingWallet = {available, version, release: () => { network.releasedWallets++; finish() }}
    })
  }
  if (path === '/api/auth/desktop/refresh') {
    network.refreshStatuses.push(response.status)
    if (response.ok && network.dropRefresh) {
      network.dropRefresh = false
      network.droppedRefreshes++
      await response.arrayBuffer()
      throw new Error('Isolated refresh response was lost')
    }
  }
  if (modelPost && response.ok && network.dropModelResult &&
    response.headers.get('content-type')?.startsWith('text/event-stream')) {
    network.dropModelResult = false
    const frames = await response.text()
    const delimiter = 'event: ncurator.result\n'
    const at = frames.indexOf(delimiter)
    if (at < 0) throw new Error('Missing settled model result in the fixture')
    network.droppedResults++
    return new Response(frames.slice(0, at) + 'data: [DONE]\n\n', { headers: {
      'content-type': 'text/event-stream'
    } })
  }
  return response
}
shell.openExternal = async (target) => {
  const url = new URL(target)
  if (url.origin !== 'https://www.guanzhangai.cn' ||
      !['/desktop/authorize', '/account', '/account/recharge', '/account/billing', '/zh/contact', '/en/contact'].includes(url.pathname)) {
    throw new Error('Unexpected external address')
  }
  network.urls.push(url.href)
}
app.on('ready', () => session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const target = new URL(details.url)
    const icon = /^\/llm\/(zhipu\.png|guanzhang\.png)$/.test(target.pathname)
    if (settings.acceptance && icon && target.origin === settings.acceptance.assets) return callback({})
    if (settings.acceptance && icon && target.origin === 'https://www.guanzhangai.cn')
      return callback({redirectURL: settings.acceptance.assets + target.pathname})
    callback({ cancel: true })
  }
))
require(settings.main)
`

type Fixture = {
  api: string
  control: string
  appKey: string
  browserArgs: string[]
  model?: { id: string; reply: string }
  acceptance?: {
    mode: 'synthetic' | 'live'
    freeId: string
    customModel: string
    assets: string
    freeDescription: string
  }
}
type Desktop = Pick<E2ETestRuntime, 'page' | 'electronApp'>
type Transport = {
  walletReads: number
  blockWallet: boolean
  urls: string[]
  holdWallet?: boolean
  dropRefresh?: boolean
  dropModelResult?: boolean
  pendingWallet?: { available: string; version: string; release: () => void }
  releasedWallets: number
  droppedRefreshes: number
  droppedResults: number
  refreshStatuses: number[]
  modelPosts: string[]
  modelLookups: string[]
}
type AccountRuntime = typeof globalThis & { __accountTestNetwork: Transport }

export const labels = {
  login: /^(?:登\s*录|Sign in)$/u,
  help: /^(?:帮助|Help)$/u,
  settings: /^(?:设置|Settings)$/u,
  balance: /可用余额|Available balance/u,
  recharge: /^(?:充\s*值|Top up)$/u,
  billing: /^(?:账\s*单|Billing)$/u,
  signOut: /^(?:退出登录|Sign out)$/u,
  stale: /余额待更新|Balance awaiting update/u,
  refund: /退款|Refund/iu
}

export const accountButton = (page: Page) => page.getByTestId('desktop-account-menu')
export const available = (page: Page) => page.getByTestId('desktop-account-available')
export const menuItem = (page: Page, name: RegExp) => page.getByRole('menuitem', { name })
export const settingsAccount = (page: Page) => page.locator('a[href="#/settings/account"]')
export async function openAccountMenu(page: Page) {
  const trigger = accountButton(page)
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByRole('menu').waitFor()
}
export const refreshWallet = (page: Page) => page.evaluate(() => window.api.desktopAccount('refresh-wallet'))
export async function readDesktopUserNo(page: Page) {
  const account = await page.evaluate(() => window.api.desktopAccount('profile'))
  return account.status === 'signed_in' ? account.userNo : undefined
}
export const externalUrls = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => [...(globalThis as AccountRuntime).__accountTestNetwork.urls])
export const walletReads = (runtime: Desktop) =>
  runtime.electronApp.evaluate(
    () => (globalThis as AccountRuntime).__accountTestNetwork.walletReads
  )
export const setWalletOffline = (runtime: Desktop, block: boolean) =>
  runtime.electronApp.evaluate((_electron, value) => {
    ;(globalThis as AccountRuntime).__accountTestNetwork.blockWallet = value
  }, block)
export const armAccountFault = (runtime: Desktop, fault: 'holdWallet' | 'dropModelResult') =>
  runtime.electronApp.evaluate((_electron, key) => {
    ;(globalThis as AccountRuntime).__accountTestNetwork[key] = true
  }, fault)
export const releaseWallet = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => {
    ;(globalThis as AccountRuntime).__accountTestNetwork.pendingWallet?.release()
  })
export const accountNetwork = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => {
    const {
      pendingWallet,
      releasedWallets,
      refreshStatuses,
      droppedRefreshes,
      droppedResults,
      modelPosts,
      modelLookups
    } = (globalThis as AccountRuntime).__accountTestNetwork
    return {
      heldWallet: pendingWallet && {
        available: pendingWallet.available,
        version: pendingWallet.version
      },
      releasedWallets,
      refreshStatuses,
      droppedRefreshes,
      droppedResults,
      modelPosts,
      modelLookups
    }
  })
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
  authorize: (
    runtime: Desktop,
    page: Page,
    email: string,
    options?: { signedIn?: true }
  ) => Promise<void>
  userNumber: (page: Page) => Promise<string>
  recharge: (page: Page) => Promise<void>
  checkOverseas: () => Promise<void>
  launchSecondDesktop: (input?: {
    userDataDir?: string
    dropRefresh?: boolean
  }) => ReturnType<typeof launchElectronApp>
  evidence: (email: string) => Promise<AccountEvidence>
  model: Fixture['model']
  acceptance?: {
    proxy: Awaited<ReturnType<typeof startNodeOneProxy>>
    freeId: string
    customModel: string
    credential: string
    freeDescription: string
    evidence: () => Promise<ProfileEvidence>
    manager: () => Promise<Page>
  }
}
export type ProfileEvidence = {
  freeSource?: {
    requests: number
    completed: number
    maximumBytes: number
    closed: boolean
    model: string
    maxOutputTokens: number
  }
  users: { id: string; email: string }[]
  sessions: number
  calls: { id: string; requestId: string }[]
  wallets: {
    userId: string
    paidAvailableAmount: string
    usageFrozenAmount: string
    refundFrozenAmount: string
    debtAmount: string
    version: string
  }[]
  recharge: number
  adjustments: number
  refunds: number
}
type AccountEvidence = {
  sessions: {
    clientType: string
    revokedReason: string | null
    lastActivityAt: string
    refreshRetryExpiresAt: string | null
  }[]
  calls: { requestId: string; paidAmount: string; feeDecision: string; executionStatus: string }[]
}

export const newTestEmail = (prefix: string) => prefix + '-' + randomUUID() + '@example.test'
export const mask = (email: string) => email[0] + '***@example.test'

export async function withAccountFixture(
  run: (
    setup: { sourceAppPath: string; extraEnv: Record<string, string> },
    service: Service
  ) => Promise<void>,
  options?: { nodeOneAcceptance: true; realModels?: true }
) {
  const fixture = await loadFixture()
  if (options?.nodeOneAcceptance && (!options.realModels || fixture.acceptance?.mode !== 'live'))
    throw new Error('node-one:real-models-required-synthetic-paused')
  const target = options?.realModels ? resolveLiveLlmTarget() : undefined
  if (
    target &&
    (target.providerId !== 'custom' ||
      target.modelName !== 'gpt-6-luna' ||
      target.baseUrl !== 'http://127.0.0.1:8317/v1')
  )
    throw new Error('node-one:unexpected-real-target')
  const proxy = options?.nodeOneAcceptance
    ? await startNodeOneProxy({
        freeTarget: fixture.api + '/api/v2/free/chat/completions',
        customTarget: target!.baseUrl + '/chat/completions',
        customKey: target!.apiKey,
        customModel: fixture.acceptance!.customModel,
        freeId: fixture.acceptance!.freeId
      })
    : undefined
  const root = await mkdtemp(join(tmpdir(), 'ncurator-account-e2e-'))
  const extraEnv = {
    NCURATOR_ACCOUNT_TEST_INPUT: JSON.stringify({
      api: fixture.api,
      main: resolve('out/main/index.js'),
      ...(proxy && {
        acceptance: {
          proxyOrigin: proxy.origin,
          assets: fixture.acceptance!.assets,
          customBase: target!.baseUrl
        }
      })
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
    const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      version: string
    }
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'ncurator-account-test', version, main: 'main.cjs' })
    )
    await writeFile(join(root, 'main.cjs'), sourceBootstrap)
    const browser = await chromium.launch({
      channel: process.env.NCURATOR_E2E_BROWSER_CHANNEL,
      args: fixture.browserArgs
    })
    try {
      const service: Service = {
        model: fixture.model,
        ...(proxy && {
          acceptance: {
            proxy,
            freeId: fixture.acceptance!.freeId,
            customModel: fixture.acceptance!.customModel,
            credential: target!.apiKey,
            freeDescription: fixture.acceptance!.freeDescription,
            async evidence() {
              const result = await post('/profile-evidence', {})
              if (result.status !== 200) throw new Error('node-one:evidence')
              return (await result.json()) as ProfileEvidence
            },
            async manager() {
              const result = await post('/manager', {})
              if (result.status !== 200) throw new Error('node-one:evidence')
              const { raw } = (await result.json()) as { raw: string }
              const context = await browser.newContext({
                ignoreHTTPSErrors: true,
                serviceWorkers: 'block'
              })
              await context.addCookies([
                {
                  name: 'ncurator_cn_session',
                  value: raw,
                  url: api,
                  secure: true,
                  httpOnly: true,
                  sameSite: 'Lax'
                }
              ])
              return context.newPage()
            }
          }
        }),
        launchSecondDesktop: (input) =>
          launchElectronApp({
            serviceMode: 'real',
            sourceAppPath: root,
            windowMode: 'visible',
            userDataDir: input?.userDataDir,
            extraEnv: {
              ...extraEnv,
              NCURATOR_ACCOUNT_TEST_INPUT: JSON.stringify({
                api: fixture.api,
                main: resolve('out/main/index.js'),
                dropRefresh: input?.dropRefresh
              })
            }
          }),
        async evidence(email) {
          const response = await post('/evidence', { email })
          expect(response.status).toBe(200)
          return (await response.json()) as AccountEvidence
        },
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
        async authorize(desktop, page, email, options) {
          const desktopPage = desktop.page
          const before = (await externalUrls(desktop)).length
          const route = await desktopPage.evaluate(() => location.hash)
          await openAccountMenu(desktopPage)
          await menuItem(desktopPage, labels.login).click()
          await expect.poll(async () => (await externalUrls(desktop)).length).toBe(before + 1)
          expect(await desktopPage.evaluate(() => location.hash)).toBe(route)
          const target = new URL((await externalUrls(desktop)).at(-1)!)
          expect(target.origin + target.pathname + target.search).toBe(site + '/desktop/authorize')
          expect([...new URLSearchParams(target.hash.slice(1)).keys()].sort()).toEqual([
            'flow',
            'state'
          ])
          if (options?.signedIn) await page.goto(target.href)
          else await service.signIn(page, email, target.href)
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
          await accountButton(desktopPage).getByText(mask(email), { exact: true }).waitFor()
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
    await proxy?.close()
    await rm(root, { recursive: true, force: true })
  }
}

export async function returnToDesktop(runtime: Desktop) {
  await runtime.page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

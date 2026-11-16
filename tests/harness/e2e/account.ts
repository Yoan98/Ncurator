import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type ElectronApplication, type Page } from 'playwright'
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
const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const packageKey = app.isPackaged
  ? JSON.parse(readFileSync(join(process.resourcesPath, 'app-distribution.json'), 'utf8')).appKey
  : undefined
if (app.isPackaged && !packageKey) throw new Error('Package is missing its official application key')
const origin = new URL(settings.api)
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('Expected a local test API')
const fetchNetwork = globalThis.fetch
const network = { walletReads: 0, blockWallet: false, urls: [], refreshStatuses: [],
  modelPosts: [], modelResponses: [], modelLookups: [], droppedRefreshes: 0, droppedResults: 0, releasedWallets: 0,
  dropRefresh: settings.dropRefresh === true }
globalThis.__accountTestNetwork = network
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const path = url.pathname
  const modelPost = path === '/api/v2/managed/chat/completions'
  const freePost = settings.acceptance && path === '/api/v2/free/chat/completions'
  if (settings.acceptance && url.origin === settings.acceptance.proxyOrigin) {
    if (request.method === 'GET' && path === '/custom/models')
      return fetchNetwork(settings.acceptance.customBase + '/models', {headers: request.headers, signal: request.signal, redirect: 'error'})
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
  const modelRequestId = modelPost ? JSON.parse(Buffer.from(body).toString()).requestId : undefined
  if (modelRequestId) network.modelPosts.push(modelRequestId)
  if (lookup) network.modelLookups.push(lookup[1])
  const headers = new Headers(request.headers)
  if (packageKey) {
    const actual = headers.get('x-ncurator-signature')
    const payload = [request.method, path, headers.get('x-ncurator-timestamp'), headers.get('x-ncurator-nonce'),
      createHash('sha256').update(Buffer.from(body || [])).digest('hex')].join('\n')
    const signature = key => createHmac('sha256', key).update(payload).digest('hex')
    if (!/^[a-f0-9]{64}$/.test(actual || '') ||
        !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(signature(packageKey), 'hex'))) {
      throw new Error('Installed app sent an invalid gateway signature')
    }
    headers.set('x-ncurator-signature', signature(settings.fixtureKey))
  }
  const response = await fetchNetwork(freePost ? settings.acceptance.proxyOrigin + '/free' : new URL(path + url.search, origin), {
    method: request.method, headers, signal: request.signal, redirect: 'error',
    ...(body && { body })
  })
  if (modelPost) network.modelResponses.push(response.status)
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
  if (modelPost && response.ok && (network.dropModelResult || network.holdModelResult) &&
    response.headers.get('content-type')?.startsWith('text/event-stream')) {
    const hold = network.holdModelResult
    network.holdModelResult = false
    network.dropModelResult = false
    const frames = await response.text()
    const delimiter = 'event: ncurator.result\n'
    const at = frames.indexOf(delimiter)
    if (at < 0) throw new Error('Missing settled model result in the fixture')
    if (hold) {
      await new Promise(resolve => {
        const release = () => { clearTimeout(timer); network.heldModelResult = undefined; resolve() }
        const timer = setTimeout(release, 30000)
        network.heldModelResult = { requestId: modelRequestId, release }
      })
      return new Response(frames, { headers: { 'content-type': 'text/event-stream' } })
    }
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
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const target = new URL(details.url)
    if (settings.liveManaged && details.resourceType === 'image' &&
      target.href === 'https://www.guanzhangai.cn/llm/deepseek.png') return callback({})
    const icon = /^\/llm\/(zhipu\.png|deepseek\.png)$/.test(target.pathname)
    if (icon && target.origin === settings.assets) return callback({})
    if (settings.assets && icon && target.origin === 'https://www.guanzhangai.cn')
      return callback({redirectURL: settings.assets + target.pathname})
    callback({ cancel: true })
  }
))
if (!app.isPackaged) require(settings.main)
`

type Fixture = {
  api: string
  control: string
  appKey: string
  browserArgs: string[]
  assets?: string
  model?: { id: string; label: string; visionLive?: true }
  acceptance?: {
    mode: 'live'
    freeId: string
    customModel: string
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
  holdModelResult?: boolean
  heldModelResult?: { requestId: string; release: () => void }
  pendingWallet?: { available: string; version: string; release: () => void }
  releasedWallets: number
  droppedRefreshes: number
  droppedResults: number
  refreshStatuses: number[]
  modelPosts: string[]
  modelResponses: number[]
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
export const refreshWallet = (page: Page) =>
  page.evaluate(() => window.api.desktopAccount('refresh-wallet'))
export async function readDesktopUserNo(page: Page) {
  const account = await page.evaluate(() => window.api.desktopAccount('profile'))
  return account.status === 'signed_in' ? account.userNo : undefined
}
export const readWebsiteWallet = (page: Page) =>
  page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to read the isolated website wallet')
    return (await response.json()) as {
      available: string
      refundFrozen: string
      usageFrozen: string
      debt: string
      settlementPending: boolean
    }
  }, api + '/api/account/wallet')
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
export const armAccountFault = (
  runtime: Desktop,
  fault: 'holdWallet' | 'dropModelResult' | 'holdModelResult'
) =>
  runtime.electronApp.evaluate((_electron, key) => {
    ;(globalThis as AccountRuntime).__accountTestNetwork[key] = true
  }, fault)
export const releaseWallet = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => {
    ;(globalThis as AccountRuntime).__accountTestNetwork.pendingWallet?.release()
  })
export const releaseModelResult = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => {
    ;(globalThis as AccountRuntime).__accountTestNetwork.heldModelResult?.release()
  })
export const accountNetwork = (runtime: Desktop) =>
  runtime.electronApp.evaluate(() => {
    const {
      pendingWallet,
      heldModelResult,
      releasedWallets,
      refreshStatuses,
      droppedRefreshes,
      droppedResults,
      modelPosts,
      modelResponses,
      modelLookups
    } = (globalThis as AccountRuntime).__accountTestNetwork
    return {
      heldWallet: pendingWallet && {
        available: pendingWallet.available,
        version: pendingWallet.version
      },
      heldModelRequestId: heldModelResult?.requestId,
      releasedWallets,
      refreshStatuses,
      droppedRefreshes,
      droppedResults,
      modelPosts,
      modelResponses,
      modelLookups
    }
  })
const isLoopback = (value: string) => {
  const url = new URL(value)
  return (
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value && !!url.port
  )
}
async function loadFixture(vision: boolean): Promise<Fixture> {
  const key = vision ? 'NCURATOR_ACCOUNT_VISION_E2E_FIXTURE' : 'NCURATOR_ACCOUNT_E2E_FIXTURE'
  const path = process.env[key]
  if (!path) throw new Error('Configure the isolated account service with ' + key)
  const fixture = JSON.parse(await readFile(path, 'utf8')) as Fixture
  if (
    !isLoopback(fixture.api) ||
    !isLoopback(fixture.control) ||
    (fixture.assets !== undefined && !isLoopback(fixture.assets)) ||
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
  approveDesktop: (page: Page) => Promise<URL>
  userNumber: (page: Page) => Promise<string>
  recharge: (page: Page) => Promise<string>
  manager: () => Promise<Page>
  checkOverseas: () => Promise<void>
  launchSecondDesktop: (input?: {
    userDataDir?: string
    dropRefresh?: boolean
  }) => ReturnType<typeof launchElectronApp>
  evidence: (email: string) => Promise<AccountEvidence>
  arrangeSettlement: (email: string, action: 'prepare' | 'settle') => Promise<void>
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
  calls: {
    requestId: string
    paidAmount: string
    feeDecision: string
    executionStatus: string
    inputTokens?: string | null
    outputTokens?: string | null
    finishReason?: string | null
  }[]
  vision?: {
    imageRequests: string[][]
    upstreamStatuses: number[]
    wallet: { paidAvailableAmount: string; usageFrozenAmount: string; debtAmount: string }
  }
}

export const newTestEmail = (prefix: string) => prefix + '-' + randomUUID() + '@example.test'
export const mask = (email: string) => email[0] + '***@example.test'

export async function openDesktopAuthorization(desktop: Desktop) {
  const { page } = desktop
  const before = (await externalUrls(desktop)).length
  const route = await page.evaluate(() => location.hash)
  await openAccountMenu(page)
  await menuItem(page, labels.login).click()
  await expect.poll(async () => (await externalUrls(desktop)).length).toBe(before + 1)
  expect(await page.evaluate(() => location.hash)).toBe(route)
  const target = new URL((await externalUrls(desktop)).at(-1)!)
  expect(target.origin + target.pathname + target.search).toBe(site + '/desktop/authorize')
  expect([...new URLSearchParams(target.hash.slice(1)).keys()].sort()).toEqual(['flow', 'state'])
  return target
}

export async function deliverDesktopAuthorization(desktop: Desktop, callback: URL) {
  await desktop.electronApp.evaluate(({ app }, link) => {
    app.emit('open-url', { preventDefault() {} }, link)
  }, callback.href)
}

export async function withAccountFixture(
  run: (
    setup: {
      sourceAppPath?: string
      extraEnv: Record<string, string>
      prepareApplication?: (application: ElectronApplication) => Promise<void>
    },
    service: Service
  ) => Promise<void>,
  options?: { nodeOneAcceptance?: true; realModels?: true; vision?: true }
) {
  const fixture = await loadFixture(options?.vision === true)
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
  const packaged = process.env.NCURATOR_E2E_APP_TARGET === 'package'
  const denyProxy = createServer((_request, reply) => reply.writeHead(403).end())
  denyProxy.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  const settings = {
    api: fixture.api,
    main: resolve('out/main/index.js'),
    assets: fixture.assets,
    liveManaged: fixture.model?.visionLive,
    ...(packaged && { fixtureKey: fixture.appKey }),
    ...(proxy && { acceptance: { proxyOrigin: proxy.origin, customBase: target!.baseUrl } })
  }
  const prepareApplication = packaged
    ? async (application: ElectronApplication) => {
        await application.evaluate(({ app }, source) => {
          const createRequire = process.getBuiltinModule('node:module')!.createRequire
          const localRequire = createRequire(app.getAppPath() + '/package.json')
          new Function('require', source)(localRequire)
        }, sourceBootstrap)
        // On restart the blocked pre-test request can finish before fixture routing is attached.
        // Reloading the renderer uses the application's own restore path.
        const page = await application.firstWindow()
        await page.reload()
      }
    : undefined
  const extraEnv = {
    NCURATOR_ACCOUNT_TEST_INPUT: JSON.stringify(settings),
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
    const started = await post('/begin-case', {})
    if (!started.ok) throw new Error(`Isolated account fixture could not start the case (${started.status})`)
    if (packaged) {
      const port = await new Promise<number>((done, fail) => {
        denyProxy.once('error', fail)
        denyProxy.listen(0, '127.0.0.1', () => {
          const address = denyProxy.address()
          if (!address || typeof address === 'string') fail(new Error('Missing test proxy port'))
          else done(address.port)
        })
      })
      const origin = 'http://127.0.0.1:' + port
      Object.assign(extraEnv, {
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: origin,
        HTTPS_PROXY: origin,
        http_proxy: origin,
        https_proxy: origin,
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1'
      })
    }
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
        async manager() {
          const result = await post('/manager', {})
          expect(result.status).toBe(200)
          const { session } = (await result.json()) as { session: string }
          const page = await service.browserPage()
          await page.context().addCookies([
            {
              name: 'ncurator_cn_session',
              value: session,
              url: api,
              secure: true,
              httpOnly: true,
              sameSite: 'Lax'
            }
          ])
          return page
        },
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
            manager: () => service.manager()
          }
        }),
        launchSecondDesktop: (input) =>
          launchElectronApp({
            serviceMode: 'real',
            sourceAppPath: packaged ? undefined : root,
            prepareApplication,
            windowMode: 'visible',
            userDataDir: input?.userDataDir,
            extraEnv: {
              ...extraEnv,
              NCURATOR_ACCOUNT_TEST_INPUT: JSON.stringify({
                ...settings,
                dropRefresh: input?.dropRefresh
              })
            }
          }),
        async arrangeSettlement(email, action) {
          const response = await post('/test-settlement', { email, action })
          expect(response.status).toBe(200)
        },
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
          await page.getByRole('button', { name: /^(继续|获取邮箱验证码)$/u }).click()
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
          const target = await openDesktopAuthorization(desktop)
          if (options?.signedIn) await page.goto(target.href)
          else await service.signIn(page, email, target.href)
          await deliverDesktopAuthorization(desktop, await service.approveDesktop(page))
          await page.getByRole('heading', { name: '登录成功', exact: true }).waitFor()
          await accountButton(desktop.page).getByText(mask(email), { exact: true }).waitFor()
        },
        async approveDesktop(page) {
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
          return callback
        },
        async userNumber(page) {
          await page.goto(site + '/account')
          await page.getByRole('heading', { name: '账户', exact: true }).waitFor()
          const session = await page.evaluate(async (url) => {
            const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
            if (!response.ok) throw new Error('Unable to read the signed-in account')
            return (await response.json()) as { userNo: string }
          }, api + '/api/auth/session')
          expect(session.userNo).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u)
          return session.userNo
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
            return orderNo
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
      await run(
        { sourceAppPath: packaged ? undefined : root, extraEnv, prepareApplication },
        service
      )
    } finally {
      await browser.close()
    }
  } finally {
    await proxy?.close()
    if (denyProxy.listening) await new Promise<void>((done) => denyProxy.close(() => done()))
    await rm(root, { recursive: true, force: true })
  }
}

export async function returnToDesktop(runtime: Desktop) {
  await runtime.page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

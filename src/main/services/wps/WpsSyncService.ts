import { randomUUID } from 'node:crypto'
import type {
  ReviewLocation,
  ReviewNavigationResult,
  OfficeReviewSelection
} from '../../../shared/fileReview'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, shell } from 'electron'
import { WPS_ADDON_FILES, WPS_PREFERRED_SYNC_PORT } from './constants'
import {
  WpsAddonInstaller,
  getWpsAddonAvailability,
  type WpsAddonInstallerLike
} from './WpsAddonInstaller'
import type {
  WpsAddonAvailability,
  WpsHost,
  WpsIntegrationIssue,
  WpsIntegrationNotice
} from '../../../shared/wpsIntegration'
import { normalizeOfficePath, officeWriteHostForPath } from './officeFileWriteNotify'
import { resolveWpsComponentExe, resolveWpsOfficeAppPath } from './wpsOfficeLaunch'

export type WpsOpenDocument = {
  name?: string
  fullName?: string
  saved?: unknown
}

type ClientDocuments = {
  component: string
  documents: Map<string, WpsOpenDocument>
}

// 同一组件可能同时活着多个加载项实例，按 component 存会互相覆盖，只有按 clientId 存才对得上。
export class WpsOpenDocumentRegistry {
  private readonly byClient = new Map<string, ClientDocuments>()

  public setDocuments(clientId: string, component: string, items: WpsOpenDocument[]): void {
    const documents = new Map<string, WpsOpenDocument>()
    for (const item of items) {
      const fullName = String(item.fullName || '').trim()
      if (!fullName) continue
      documents.set(normalizeOfficePath(fullName), item)
    }
    this.byClient.set(clientId, { component, documents })
  }

  public isOpen(filePath: string): boolean {
    return this.clientFor(filePath) !== undefined
  }

  public remove(filePath: string): void {
    const key = normalizeOfficePath(filePath)
    for (const entry of this.byClient.values()) {
      entry.documents.delete(key)
    }
  }

  public clientFor(filePath: string): string | undefined {
    const key = normalizeOfficePath(filePath)
    for (const [clientId, entry] of this.byClient) {
      if (entry.documents.has(key)) return clientId
    }
    return undefined
  }

  public componentFor(filePath: string): string | undefined {
    const key = normalizeOfficePath(filePath)
    for (const entry of this.byClient.values()) {
      if (entry.documents.has(key)) return entry.component
    }
    return undefined
  }

  public listOpenDocuments(): Array<{ clientId: string; component: string; fullName: string }> {
    const listed: Array<{ clientId: string; component: string; fullName: string }> = []
    for (const [clientId, entry] of this.byClient) {
      for (const item of entry.documents.values()) {
        const fullName = String(item.fullName || '').trim()
        if (!fullName) continue
        listed.push({ clientId, component: entry.component, fullName })
      }
    }
    return listed
  }

  public upsert(clientId: string, component: string, filePath: string): void {
    const fullName = String(filePath || '').trim()
    if (!fullName) return
    let entry = this.byClient.get(clientId)
    if (!entry) {
      entry = { component, documents: new Map() }
      this.byClient.set(clientId, entry)
    }
    entry.documents.set(normalizeOfficePath(fullName), {
      name: path.basename(fullName),
      fullName
    })
  }

  // 实例断开后它的文档就不存在了，留着会让馆长把 close / open 投给幽灵客户端。
  public dropClient(clientId: string): void {
    this.byClient.delete(clientId)
  }

  public clear(): void {
    this.byClient.clear()
  }
}

type SseClient = {
  response: ServerResponse
  component: string
  clientId: string
}

type BroadcastTarget = {
  clientId?: string
  component?: string
}

export type WpsReloadDispatch = {
  path: string
  at: number
  clientCount: number
}

export type WpsReloadResult = {
  at: number
  component: string
  clientId: string
  ok: boolean
  fullName: string
  excerpt: string
  reason?: string
  targetPath?: string
}

export type WpsAddonFetch = {
  path: string
  at: number
}

export type WpsCloseResult = {
  at: number
  component: string
  clientId: string
  ok: boolean
  fullName: string
  remaining: number
  placeholder: boolean
  reason?: string
  targetPath?: string
}

export type WpsSyncStatus = {
  ok: true
  clientCount: number
  clients: Array<{ component: string; clientId: string }>
  openDocuments: Array<{ clientId: string; component: string; fullName: string }>
  lastNavigationResults: Array<{
    requestId: string
    clientId: string
    fullName: string
    status: string
    location?: ReviewLocation
    selection?: OfficeReviewSelection
    reason?: string
  }>
  lastDispatches: WpsReloadDispatch[]
  lastReloadResults: WpsReloadResult[]
  lastCloseResults: WpsCloseResult[]
  lastAddonFetches: WpsAddonFetch[]
}

type WpsAddonReport = {
  kind?: string
  component?: string
  clientId?: string
  at?: number
  data?: {
    selection?: OfficeReviewSelection
    requestId?: string
    status?: ReviewNavigationResult['status']
    location?: ReviewLocation
    items?: WpsOpenDocument[]
    ok?: boolean
    fullName?: string
    excerpt?: string
    reason?: string
    targetPath?: string
    remaining?: number
    placeholder?: boolean
  }
}

export type WpsSyncServiceOptions = {
  readAvailability?: (host: WpsHost) => Promise<WpsAddonAvailability>
  onNotice?: (notice: WpsIntegrationNotice) => void
  installer?: WpsAddonInstallerLike
  addonSourceDir?: string
  preferredPort?: number
  skipInstall?: boolean
}

const MAX_REPORT_BYTES = 1024 * 1024
const MAX_STATUS_EVENTS = 32
const CLOSE_WAIT_MS = 3_000
const CLOSE_POLL_MS = 50
const ADDON_OPEN_FALLBACK_MS = 5_000
const SHELL_LIST_POLL_MS = 500
const SHELL_LIST_TIMEOUT_MS = 40_000

type PendingReopen = 'addin' | 'shell'

type PendingOpen = {
  path: string
  component: string
  clientId?: string
  at: number
  reopen: PendingReopen
  shellUsed: boolean
  excerptSent?: boolean
  timer?: ReturnType<typeof setTimeout>
}

type ReleasedClose = {
  component: string
  clientId?: string
  remaining: number
  placeholder: boolean
}

const ADDON_FILE_SET = new Set<string>(WPS_ADDON_FILES)
const ADDON_CONTENT_TYPE: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

const isLoopbackHost = (host: string): boolean =>
  host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host === '127.0.0.1'

const resolveAddonSourceDir = (override?: string): string => {
  if (override) return override
  if (app.isPackaged) return path.join(process.resourcesPath, 'wps-addon')
  return path.join(process.cwd(), 'resources', 'wps-addon')
}

const shouldSkipWpsInstall = (): boolean => process.env.NCURATOR_E2E_OBSERVER === '1'

const isWpsSyncStatusBody = (body: unknown): boolean => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as { ok?: unknown; clients?: unknown }
  return record.ok === true && Array.isArray(record.clients)
}

const probeWpsSyncPort = async (port: number, timeoutMs = 400): Promise<boolean> => {
  if (!Number.isInteger(port) || port <= 0) return false
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/status',
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > 64 * 1024) {
            request.destroy()
            finish(false)
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (response.statusCode !== 200) {
            finish(false)
            return
          }
          try {
            finish(isWpsSyncStatusBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
          } catch {
            finish(false)
          }
        })
      }
    )
    request.on('timeout', () => {
      request.destroy()
      finish(false)
    })
    request.on('error', () => finish(false))
  })
}

const readRequestBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_REPORT_BYTES) {
        request.destroy()
        reject(new Error('report body too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  response.end(JSON.stringify(body))
}

const writeSse = (response: ServerResponse, payload: unknown): void => {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export class WpsSyncService {
  private readonly navigationOpens = new Map<string, Promise<void>>()
  private readonly latestNavigation = new Map<string, string>()
  private readonly navigationResults = new Map<
    string,
    { clientId: string; path: string; finish: (value: ReviewNavigationResult) => void }
  >()
  private readonly lastNavigationResults: Array<{
    requestId: string
    clientId: string
    fullName: string
    status: string
    location?: ReviewLocation
    selection?: OfficeReviewSelection
    reason?: string
  }> = []

  public async navigate(
    filePath: string,
    target: ReviewLocation | null,
    open: () => Promise<void>
  ): Promise<ReviewNavigationResult> {
    const resolved = path.resolve(filePath),
      key = normalizeOfficePath(resolved),
      requestId = randomUUID()
    this.latestNavigation.set(key, requestId)
    try {
      const host = officeWriteHostForPath(resolved)
      const availability = host ? await this.readAvailability(host) : undefined
      if (host && availability === 'disabled') {
        this.watchRecovery(host)
        await open()
        return {
          status: 'opened',
          issue: { host, state: 'not-enabled' },
          reason: 'WPS 加载项未启用，未完成定位'
        }
      }
      if (host && availability === 'enabled' && this.hasComponentClient(host)) this.markReady(host)
      if (!this.registry.clientFor(resolved)) {
        let pending = this.navigationOpens.get(key)
        if (!pending) {
          pending = (async () => {
            await open()
            if (!this.server) return
            const deadline = Date.now() + SHELL_LIST_TIMEOUT_MS
            while (!this.stopped && Date.now() < deadline && !this.registry.clientFor(resolved)) {
              this.broadcast({ type: 'list' }, { component: officeWriteHostForPath(resolved) })
              await new Promise((resolve) => setTimeout(resolve, SHELL_LIST_POLL_MS))
            }
          })().finally(() => this.navigationOpens.delete(key))
          this.navigationOpens.set(key, pending)
        }
        await pending
      }
      if (this.latestNavigation.get(key) !== requestId)
        return { status: 'opened', reason: '已切换到其他定位请求' }
      const clientId = this.registry.clientFor(resolved)
      if (!clientId || !this.hasClient(clientId))
        return {
          status: 'opened',
          issue: host ? await this.integrationIssue(host) : undefined,
          reason: '已请求用 WPS 打开文件，但未收到目标文档确认，请检查 WPS 中的文件访问或加载提示'
        }
      return await new Promise<ReviewNavigationResult>((resolve) => {
        const timer = setTimeout(
          () => finish({ status: 'opened', reason: 'WPS 定位响应超时，未确认目标位置' }),
          5000
        )
        const finish = (result: ReviewNavigationResult): void => {
          clearTimeout(timer)
          this.navigationResults.delete(requestId)
          resolve(result)
        }
        this.navigationResults.set(requestId, { clientId, path: resolved, finish })
        this.broadcast({ type: 'navigate', requestId, path: resolved, target }, { clientId })
      })
    } finally {
      if (this.latestNavigation.get(key) === requestId) this.latestNavigation.delete(key)
    }
  }

  private readonly installer: WpsAddonInstallerLike
  private readonly preferredPort: number
  private readonly skipInstall: boolean
  private readonly addonSourceDir: string
  private readonly registry = new WpsOpenDocumentRegistry()
  private readonly clients = new Set<SseClient>()
  private readonly lastDispatches: WpsReloadDispatch[] = []
  private readonly lastReloadResults: WpsReloadResult[] = []
  private readonly lastAddonFetches: WpsAddonFetch[] = []
  private readonly lastCloseResults: WpsCloseResult[] = []
  private readonly releasedCloses = new Map<string, ReleasedClose>()
  private readonly pendingOpens = new Map<string, PendingOpen>()
  private server: Server | undefined
  private port: number | undefined
  private stopped = false
  private readonly readAvailability: (host: WpsHost) => Promise<WpsAddonAvailability>
  private readonly onNotice?: (notice: WpsIntegrationNotice) => void
  private readonly disconnectedDocuments = new Map<string, number>()
  private readonly unavailableHosts = new Set<WpsHost>()
  private recoveryTimer?: ReturnType<typeof setInterval>
  private checkingRecovery = false

  public constructor(options: WpsSyncServiceOptions = {}) {
    this.readAvailability = options.readAvailability ?? getWpsAddonAvailability
    this.onNotice = options.onNotice
    this.installer =
      options.installer ??
      new WpsAddonInstaller({
        addonSourceDir: resolveAddonSourceDir(options.addonSourceDir)
      })
    this.preferredPort = options.preferredPort ?? WPS_PREFERRED_SYNC_PORT
    this.skipInstall = options.skipInstall ?? shouldSkipWpsInstall()
    this.addonSourceDir = resolveAddonSourceDir(options.addonSourceDir)
  }

  private async integrationIssue(host: WpsHost): Promise<WpsIntegrationIssue | undefined> {
    const availability = await this.readAvailability(host).catch(() => 'unconfirmed' as const)
    if (availability === 'disabled') {
      this.watchRecovery(host)
      return { host, state: 'not-enabled' }
    }
    if (this.hasComponentClient(host)) {
      if (availability === 'enabled') this.markReady(host)
      return undefined
    }
    this.watchRecovery(host)
    return { host, state: availability === 'enabled' ? 'not-connected' : 'unconfirmed' }
  }

  private watchRecovery(host: WpsHost): void {
    if (this.stopped) return
    this.unavailableHosts.add(host)
    if (this.recoveryTimer) return
    // Only watch components that have reported an issue. Stop once they recover;
    // an old stream alone must not override an explicitly disabled add-in.
    this.recoveryTimer = setInterval(() => void this.checkRecovery(), 1000)
    this.recoveryTimer.unref?.()
  }

  private async checkRecovery(): Promise<void> {
    if (this.checkingRecovery || this.stopped) return
    this.checkingRecovery = true
    try {
      for (const host of this.unavailableHosts) {
        if (!this.hasComponentClient(host)) continue
        const availability = await this.readAvailability(host).catch(() => 'unconfirmed' as const)
        if (!this.stopped && availability === 'enabled' && this.hasComponentClient(host))
          this.markReady(host)
      }
    } finally {
      this.checkingRecovery = false
    }
  }

  private markReady(host: WpsHost): void {
    if (!this.unavailableHosts.delete(host)) return
    if (this.unavailableHosts.size === 0 && this.recoveryTimer) {
      clearInterval(this.recoveryTimer)
      this.recoveryTimer = undefined
    }
    this.onNotice?.({ kind: 'ready', host })
  }

  public async notifyOpened(filePath: string): Promise<void> {
    const host = officeWriteHostForPath(filePath)
    if (!host) return
    const availability = await this.readAvailability(host).catch(() => 'unconfirmed' as const)
    if (availability !== 'disabled') {
      const deadline = Date.now() + 8000
      while (!this.stopped && !this.hasComponentClient(host) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, SHELL_LIST_POLL_MS))
    }
    const issue = await this.integrationIssue(host)
    if (issue) this.onNotice?.({ kind: 'integration', issue })
  }

  public getPort(): number | undefined {
    return this.port
  }

  public getOpenRegistry(): WpsOpenDocumentRegistry {
    return this.registry
  }

  public async start(): Promise<void> {
    if (this.server || this.stopped) return
    if (!this.skipInstall) {
      const result = await this.installer.install().catch((error: unknown) => {
        console.warn(
          '[WPS-SYNC] addon install skipped:',
          error instanceof Error ? error.message : String(error)
        )
        return { installed: false as const, reason: 'install-failed' }
      })
      if (!result.installed) return
    }

    if (
      !this.skipInstall &&
      this.preferredPort > 0 &&
      (await probeWpsSyncPort(this.preferredPort))
    ) {
      await this.rewriteRegistration(this.preferredPort, { whenSkipInstall: false })
      return
    }

    const listenResult = await this.listen()
    if (this.stopped) {
      await this.stop()
      return
    }
    if (listenResult === 'already-serving') return
    if (this.port === undefined) return
    await this.rewriteRegistration(this.port, { whenSkipInstall: true })
  }

  private async rewriteRegistration(
    port: number,
    options: { whenSkipInstall: boolean }
  ): Promise<void> {
    if (this.skipInstall && !options.whenSkipInstall) return
    if (!Number.isInteger(port) || port <= 0) return
    await Promise.resolve(this.installer.writePort(port)).catch((error: unknown) => {
      console.warn(
        '[WPS-SYNC] failed to write port.json:',
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  public async prepareClose(filePath: string): Promise<boolean> {
    const resolvedPath = path.resolve(filePath)
    const clientId = this.registry.clientFor(resolvedPath)
    const host = officeWriteHostForPath(resolvedPath)
    const disconnectedAt = this.disconnectedDocuments.get(normalizeOfficePath(resolvedPath))
    if (host && (clientId || (disconnectedAt && Date.now() - disconnectedAt < 60_000))) {
      const issue = await this.integrationIssue(host)
      if (issue) {
        this.onNotice?.({ kind: 'integration', issue })
        return false
      }
    }
    if (!this.server || this.clients.size === 0) return false
    if (!clientId) return false
    const component = this.registry.componentFor(resolvedPath) || 'unknown'
    const startedAt = Date.now()
    this.broadcast({ type: 'close', path: resolvedPath }, { clientId })
    const deadline = startedAt + CLOSE_WAIT_MS
    while (Date.now() < deadline) {
      const closed = this.findCloseResult(resolvedPath, startedAt)
      if (closed) {
        // 关不掉就别写盘，否则窗口里还是旧稿而磁盘已经变了。
        if (!closed.ok) return false
        this.registry.remove(resolvedPath)
        this.releasedCloses.set(normalizeOfficePath(resolvedPath), {
          component: closed.component || component,
          clientId: closed.clientId || clientId,
          remaining: closed.remaining,
          placeholder: closed.placeholder
        })
        return true
      }
      if (!this.hasClient(clientId)) {
        this.registry.remove(resolvedPath)
        this.releasedCloses.set(normalizeOfficePath(resolvedPath), {
          component,
          clientId,
          remaining: 0,
          placeholder: false
        })
        return true
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CLOSE_POLL_MS)
      })
    }
    return false
  }

  public async notifyWritten(filePath: string): Promise<void> {
    if (!this.server) return
    const resolvedPath = path.resolve(filePath)
    const key = normalizeOfficePath(resolvedPath)
    const released = this.releasedCloses.get(key)
    this.releasedCloses.delete(key)
    this.pushCapped(this.lastDispatches, {
      path: resolvedPath,
      at: Date.now(),
      clientCount: this.clients.size
    })
    // A file that was never known open in WPS needs no refresh and no prompt.
    if (!released && !this.registry.isOpen(resolvedPath)) return
    const component =
      released && released.component !== 'unknown'
        ? released.component
        : officeWriteHostForPath(resolvedPath) || 'unknown'
    const host = officeWriteHostForPath(resolvedPath)
    if (host) {
      const issue = await this.integrationIssue(host)
      if (issue?.state === 'not-enabled' || (!released && issue)) {
        this.onNotice?.({ kind: 'integration', issue })
        return
      }
    }
    this.clearPendingOpen(resolvedPath)
    this.pendingOpens.set(key, {
      path: resolvedPath,
      component,
      clientId: released?.clientId,
      at: Date.now(),
      reopen: 'addin',
      shellUsed: false
    })
    // 原子替换会更换文件身份。macOS 通过 Launch Services 重开，重新交付文件访问权，
    // 避免沙盒中的 Workbooks.Open 对新文件弹出无法打开的模态错误。
    if (released && process.platform === 'darwin') {
      this.startShellReopen(resolvedPath)
      return
    }
    // 关掉最后一个文档组件就会退出，只有加载项建起了占位文档才还有人能执行 Open。
    if (released && released.remaining <= 0 && !released.placeholder) {
      this.startShellReopen(resolvedPath)
      return
    }
    if (!this.hasReopenClient(released?.clientId, component)) {
      if (released) this.startShellReopen(resolvedPath)
      return
    }
    this.startAddonReopen(resolvedPath)
  }

  public async stop(): Promise<void> {
    this.stopped = true
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = undefined
    this.unavailableHosts.clear()
    const ownedPort = this.port
    for (const client of this.clients) {
      try {
        client.response.end()
      } catch {
        // 关闭时忽略已断开的客户端。
      }
    }
    for (const pending of this.navigationResults.values())
      pending.finish({ status: 'failed', reason: '馆长已停止 WPS 通信' })
    this.clients.clear()
    this.registry.clear()
    this.lastDispatches.length = 0
    this.lastReloadResults.length = 0
    this.lastAddonFetches.length = 0
    this.lastCloseResults.length = 0
    this.releasedCloses.clear()
    for (const pending of this.pendingOpens.values()) {
      this.clearPendingTimer(pending)
    }
    this.pendingOpens.clear()
    const server = this.server
    this.server = undefined
    this.port = undefined
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
    if (ownedPort === undefined || this.preferredPort <= 0 || ownedPort === this.preferredPort) {
      return
    }
    if (await probeWpsSyncPort(this.preferredPort)) {
      await this.rewriteRegistration(this.preferredPort, { whenSkipInstall: true })
    }
  }

  private async listen(): Promise<'bound' | 'already-serving'> {
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    this.server.on('error', (error) => {
      console.warn('[WPS-SYNC] server error:', error.message)
    })

    const bind = async (port: number): Promise<number> =>
      await new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          this.server?.off('error', onError)
          reject(error)
        }
        this.server?.once('error', onError)
        this.server?.listen(port, '127.0.0.1', () => {
          this.server?.off('error', onError)
          const address = this.server?.address()
          if (!address || typeof address === 'string') {
            reject(new Error('wps sync server address unavailable'))
            return
          }
          resolve(address.port)
        })
      })

    try {
      this.port = await bind(this.preferredPort)
      return 'bound'
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
      if (
        code === 'EADDRINUSE' &&
        !this.skipInstall &&
        this.preferredPort > 0 &&
        (await probeWpsSyncPort(this.preferredPort))
      ) {
        const server = this.server
        this.server = undefined
        this.port = undefined
        if (server) {
          await new Promise<void>((resolve) => {
            server.close(() => resolve())
          })
        }
        return 'already-serving'
      }
      this.port = await bind(0)
      return 'bound'
    }
  }

  private hasClient(clientId: string): boolean {
    return [...this.clients].some((client) => client.clientId === clientId)
  }

  private hasComponentClient(component: string): boolean {
    if (component === 'unknown') return this.clients.size > 0
    return [...this.clients].some((client) => client.component === component)
  }

  private hasReopenClient(clientId: string | undefined, component: string): boolean {
    return clientId ? this.hasClient(clientId) : this.hasComponentClient(component)
  }

  private reopenTarget(pending: PendingOpen): BroadcastTarget {
    if (pending.clientId) return { clientId: pending.clientId }
    return pending.component === 'unknown' ? {} : { component: pending.component }
  }

  private reopenReleasedPath(resolvedPath: string, component: string): void {
    if (process.platform === 'darwin') {
      const wpsApp = resolveWpsOfficeAppPath()
      if (wpsApp) {
        const child = spawn('/usr/bin/open', ['-g', '-a', wpsApp, '--', resolvedPath], {
          detached: true,
          stdio: 'ignore'
        })
        child.once('error', () => undefined)
        child.unref()
        return
      }
    }
    if (process.platform === 'win32') {
      const exe = resolveWpsComponentExe(component, resolvedPath)
      if (exe) {
        const child = spawn(exe, [resolvedPath], {
          detached: true,
          stdio: 'ignore'
        })
        child.once('error', () => undefined)
        child.unref()
        return
      }
    }
    void shell.openPath(resolvedPath).catch(() => undefined)
  }

  private startAddonReopen(resolvedPath: string): void {
    const pending = this.pendingOpens.get(normalizeOfficePath(resolvedPath))
    if (!pending) return
    pending.reopen = 'addin'
    this.broadcast({ type: 'open', path: resolvedPath }, this.reopenTarget(pending))
    // 加载项可能收下 open 却打不开（组件已无活动文档），超时就换系统打开。
    this.setPendingTimer(pending, ADDON_OPEN_FALLBACK_MS, () => {
      this.startShellReopen(resolvedPath)
    })
  }

  private startShellReopen(resolvedPath: string): void {
    const pending = this.pendingOpens.get(normalizeOfficePath(resolvedPath))
    if (!pending || pending.shellUsed) return
    pending.reopen = 'shell'
    pending.shellUsed = true
    this.clearPendingTimer(pending)
    this.reopenReleasedPath(resolvedPath, pending.component)
    this.pollShellReopen(pending, Date.now() + SHELL_LIST_TIMEOUT_MS)
  }

  // 表格 / 演示组件不注册 ApiEvent，系统打开后不会主动上报文档列表，只能主动问。
  private pollShellReopen(pending: PendingOpen, deadline: number): void {
    this.setPendingTimer(pending, SHELL_LIST_POLL_MS, () => {
      if (!this.server || pending.excerptSent) return
      if (!this.pendingOpens.has(normalizeOfficePath(pending.path))) return
      this.completeShellOpens()
      if (pending.excerptSent) return
      if (Date.now() >= deadline) {
        this.reportRefreshFailure(pending)
        return
      }
      // 系统重开会换一个新实例，此时还不知道新 clientId，只能问整个组件。
      this.broadcast(
        { type: 'list' },
        pending.component === 'unknown' ? {} : { component: pending.component }
      )
      this.pollShellReopen(pending, deadline)
    })
  }

  private setPendingTimer(pending: PendingOpen, delayMs: number, run: () => void): void {
    this.clearPendingTimer(pending)
    const timer = setTimeout(() => {
      pending.timer = undefined
      if (!this.server || this.stopped) return
      run()
    }, delayMs)
    timer.unref?.()
    pending.timer = timer
  }

  private clearPendingTimer(pending: PendingOpen): void {
    if (!pending.timer) return
    clearTimeout(pending.timer)
    pending.timer = undefined
  }

  private completeShellOpens(): void {
    for (const pending of this.pendingOpens.values()) {
      if (pending.reopen !== 'shell' || pending.excerptSent) continue
      // 系统重开后持有该文档的是新实例，摘录只能向它要。
      const ownerClientId = this.registry.clientFor(pending.path)
      if (!ownerClientId || !this.hasClient(ownerClientId)) continue
      pending.clientId = ownerClientId
      pending.excerptSent = true
      this.broadcast({ type: 'excerpt', path: pending.path }, { clientId: ownerClientId })
      this.setPendingTimer(pending, 5000, () => this.reportRefreshFailure(pending))
    }
  }

  private reportRefreshFailure(pending: PendingOpen): void {
    this.clearPendingOpen(pending.path)
    const host = officeWriteHostForPath(pending.path)
    if (!host) return
    void this.integrationIssue(host).then((issue) => {
      this.onNotice?.(
        issue
          ? { kind: 'integration', issue }
          : {
              kind: 'refresh',
              reason: `未确认 WPS 已刷新“${path.basename(pending.path)}”，请在 WPS 中检查文件；磁盘写入结果不受影响`
            }
      )
    })
  }

  private broadcast(payload: unknown, target: BroadcastTarget = {}): void {
    for (const client of this.clients) {
      if (target.clientId && client.clientId !== target.clientId) continue
      if (target.component && client.component !== target.component) continue
      try {
        writeSse(client.response, payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  private flushPendingOpens(client: SseClient): void {
    for (const pending of this.pendingOpens.values()) {
      if (pending.reopen !== 'addin') continue
      if (pending.clientId) {
        if (pending.clientId !== client.clientId) continue
      } else if (pending.component !== 'unknown' && pending.component !== client.component) {
        continue
      }
      try {
        writeSse(client.response, { type: 'open', path: pending.path })
      } catch {
        this.clients.delete(client)
        return
      }
    }
  }

  private clearPendingOpen(filePath: string | undefined): void {
    if (!filePath) return
    const key = normalizeOfficePath(filePath)
    const pending = this.pendingOpens.get(key)
    if (pending) this.clearPendingTimer(pending)
    this.pendingOpens.delete(key)
  }

  // 只有被指派的那个实例说打不开才算失败，别让旁边的实例替它宣告失败。
  private fallbackFailedOpen(
    clientId: string,
    component: string,
    filePath: string | undefined
  ): void {
    if (!filePath) return
    const pending = this.pendingOpens.get(normalizeOfficePath(filePath))
    if (!pending || pending.reopen !== 'addin' || pending.shellUsed) return
    if (pending.clientId) {
      if (pending.clientId !== clientId) return
    } else if (pending.component !== 'unknown' && pending.component !== component) {
      return
    }
    this.startShellReopen(pending.path)
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = String(request.headers.host || '')
    if (!isLoopbackHost(host)) {
      sendJson(response, 403, { ok: false, error: 'loopback only' })
      return
    }

    const url = new URL(request.url || '/', `http://${host}`)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      const component = url.searchParams.get('component') || 'unknown'
      this.acceptSse(
        request,
        response,
        component,
        url.searchParams.get('clientId')?.trim() || `legacy:${component}`
      )
      return
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      sendJson(response, 200, this.buildStatus())
      return
    }

    if (request.method === 'GET' && this.isAddonAssetPath(url.pathname)) {
      await this.serveAddonFile(url.pathname, response)
      return
    }

    if (request.method === 'POST' && url.pathname === '/report') {
      try {
        const body = JSON.parse(await readRequestBody(request)) as WpsAddonReport
        const component = String(body.component || 'unknown')
        const clientId = String(body.clientId || '').trim() || `legacy:${component}`
        if (Array.isArray(body.data?.items)) {
          this.registry.setDocuments(clientId, component, body.data.items)
          this.completeShellOpens()
        }
        if (body.kind === 'navigate-result') {
          const requestId = body.data?.requestId || ''
          const pending = this.navigationResults.get(requestId)
          if (pending?.clientId === clientId) {
            const matches = this.matchesOfficePath(body.data?.fullName, pending.path)
            const result: ReviewNavigationResult = {
              status:
                matches && (body.data?.status === 'located' || body.data?.status === 'container')
                  ? body.data.status
                  : 'opened',
              reason: matches ? body.data?.reason : 'WPS 未确认目标文件，未完成定位'
            }
            this.pushCapped(this.lastNavigationResults, {
              requestId,
              clientId,
              fullName: body.data?.fullName || '',
              ...result,
              location: body.data?.location,
              selection: body.data?.selection
            })
            pending.finish(result)
          }
        }
        if (body.kind === 'close-result') {
          const fullName = String(body.data?.fullName || '')
          const targetPath = body.data?.targetPath ? String(body.data.targetPath) : undefined
          const ok = body.data?.ok === true
          this.pushCapped(this.lastCloseResults, {
            at: typeof body.at === 'number' ? body.at : Date.now(),
            component,
            clientId,
            ok,
            fullName,
            remaining: Math.max(0, Number(body.data?.remaining) || 0),
            placeholder: body.data?.placeholder === true,
            reason: body.data?.reason ? String(body.data.reason) : undefined,
            targetPath
          })
          if (ok && (fullName || targetPath)) this.registry.remove(fullName || targetPath || '')
        }
        if (body.kind === 'reload-result') {
          const fullName = String(body.data?.fullName || '')
          const targetPath = body.data?.targetPath ? String(body.data.targetPath) : undefined
          const ok = body.data?.ok === true
          this.pushCapped(this.lastReloadResults, {
            at: typeof body.at === 'number' ? body.at : Date.now(),
            component,
            clientId,
            ok,
            fullName,
            excerpt: String(body.data?.excerpt || ''),
            reason: body.data?.reason ? String(body.data.reason) : undefined,
            targetPath
          })
          if (ok) {
            this.clearPendingOpen(fullName)
            this.clearPendingOpen(targetPath)
            if (fullName || targetPath) {
              this.registry.upsert(clientId, component, fullName || targetPath || '')
            }
          } else {
            this.fallbackFailedOpen(clientId, component, targetPath || fullName)
          }
        }
        sendJson(response, 200, { ok: true })
      } catch {
        sendJson(response, 400, { ok: false })
      }
      return
    }

    sendJson(response, 404, { ok: false })
  }

  private findCloseResult(filePath: string, afterAt: number): WpsCloseResult | undefined {
    return this.lastCloseResults.find(
      (item) =>
        item.at >= afterAt &&
        (this.matchesOfficePath(item.fullName, filePath) ||
          this.matchesOfficePath(item.targetPath, filePath))
    )
  }

  private matchesOfficePath(left: string | undefined, right: string): boolean {
    return left ? normalizeOfficePath(left) === normalizeOfficePath(right) : false
  }

  private pushCapped<T>(items: T[], item: T): void {
    items.push(item)
    if (items.length > MAX_STATUS_EVENTS) {
      items.splice(0, items.length - MAX_STATUS_EVENTS)
    }
  }

  private buildStatus(): WpsSyncStatus {
    return {
      ok: true,
      clientCount: this.clients.size,
      clients: [...this.clients].map((client) => ({
        component: client.component,
        clientId: client.clientId
      })),
      openDocuments: this.registry.listOpenDocuments(),
      lastNavigationResults: [...this.lastNavigationResults],
      lastDispatches: [...this.lastDispatches],
      lastReloadResults: [...this.lastReloadResults],
      lastCloseResults: [...this.lastCloseResults],
      lastAddonFetches: [...this.lastAddonFetches]
    }
  }

  private acceptSse(
    request: IncomingMessage,
    response: ServerResponse,
    component: string,
    clientId: string
  ): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })
    const client: SseClient = { response, component, clientId }
    this.clients.add(client)
    void this.checkRecovery()
    writeSse(response, { type: 'ping' })
    writeSse(response, { type: 'list' })
    this.flushPendingOpens(client)
    request.on('close', () => {
      for (const document of this.registry.listOpenDocuments()) {
        if (document.clientId === clientId)
          this.disconnectedDocuments.set(normalizeOfficePath(document.fullName), Date.now())
      }
      for (const [key, at] of this.disconnectedDocuments) {
        if (Date.now() - at > 60_000) this.disconnectedDocuments.delete(key)
      }
      this.clients.delete(client)
      if (!this.hasClient(clientId)) this.registry.dropClient(clientId)
    })
  }

  private isAddonAssetPath(pathname: string): boolean {
    const fileName = this.addonFileName(pathname)
    return (
      pathname === '/addon' ||
      pathname.startsWith('/addon/') ||
      fileName === 'port.json' ||
      ADDON_FILE_SET.has(fileName)
    )
  }

  private addonFileName(pathname: string): string {
    if (pathname === '/addon' || pathname === '/addon/') return 'index.html'
    const relative = pathname.startsWith('/addon/')
      ? pathname.slice('/addon/'.length)
      : pathname.replace(/^\/+/, '')
    return decodeURIComponent(relative)
  }

  private async serveAddonFile(pathname: string, response: ServerResponse): Promise<void> {
    const fileName = this.addonFileName(pathname)
    this.pushCapped(this.lastAddonFetches, { path: `/${fileName}`, at: Date.now() })
    if (fileName.includes('..') || fileName.includes('/')) {
      sendJson(response, 404, { ok: false })
      return
    }
    if (fileName === 'port.json') {
      sendJson(response, 200, { port: this.port })
      return
    }
    if (!ADDON_FILE_SET.has(fileName)) {
      sendJson(response, 404, { ok: false })
      return
    }
    try {
      const body = await fs.readFile(path.join(this.addonSourceDir, fileName))
      const contentType = ADDON_CONTENT_TYPE[path.extname(fileName)] || 'application/octet-stream'
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      })
      response.end(body)
    } catch {
      sendJson(response, 404, { ok: false })
    }
  }
}

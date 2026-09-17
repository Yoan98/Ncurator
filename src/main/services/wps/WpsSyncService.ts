import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, shell } from 'electron'
import { WPS_ADDON_FILES, WPS_PREFERRED_SYNC_PORT } from './constants'
import { WpsAddonInstaller, type WpsAddonInstallerLike } from './WpsAddonInstaller'
import { normalizeOfficePath, officeWriteHostForPath } from './officeFileWriteNotify'
import { resolveWpsComponentExe } from './wpsOfficeLaunch'

export type WpsOpenDocument = {
  name?: string
  fullName?: string
  saved?: unknown
}

export class WpsOpenDocumentRegistry {
  private readonly byComponent = new Map<string, Map<string, WpsOpenDocument>>()

  public setDocuments(component: string, items: WpsOpenDocument[]): void {
    const next = new Map<string, WpsOpenDocument>()
    for (const item of items) {
      const fullName = String(item.fullName || '').trim()
      if (!fullName) continue
      next.set(normalizeOfficePath(fullName), item)
    }
    this.byComponent.set(component, next)
  }

  public isOpen(filePath: string): boolean {
    const key = normalizeOfficePath(filePath)
    for (const documents of this.byComponent.values()) {
      if (documents.has(key)) return true
    }
    return false
  }

  public remove(filePath: string): void {
    const key = normalizeOfficePath(filePath)
    for (const documents of this.byComponent.values()) {
      documents.delete(key)
    }
  }

  public componentFor(filePath: string): string | undefined {
    const key = normalizeOfficePath(filePath)
    for (const [component, documents] of this.byComponent) {
      if (documents.has(key)) return component
    }
    return undefined
  }

  public listOpenDocuments(): Array<{ component: string; fullName: string }> {
    const listed: Array<{ component: string; fullName: string }> = []
    for (const [component, documents] of this.byComponent) {
      for (const item of documents.values()) {
        const fullName = String(item.fullName || '').trim()
        if (!fullName) continue
        listed.push({ component, fullName })
      }
    }
    return listed
  }

  public upsert(component: string, filePath: string): void {
    const fullName = String(filePath || '').trim()
    if (!fullName) return
    let documents = this.byComponent.get(component)
    if (!documents) {
      documents = new Map()
      this.byComponent.set(component, documents)
    }
    documents.set(normalizeOfficePath(fullName), {
      name: path.basename(fullName),
      fullName
    })
  }

  public clear(): void {
    this.byComponent.clear()
  }
}

type SseClient = {
  response: ServerResponse
  component: string
}

export type WpsReloadDispatch = {
  path: string
  at: number
  clientCount: number
}

export type WpsReloadResult = {
  at: number
  component: string
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
  ok: boolean
  fullName: string
  remaining: number
  targetPath?: string
}

export type WpsSyncStatus = {
  ok: true
  clientCount: number
  clients: Array<{ component: string }>
  openDocuments: Array<{ component: string; fullName: string }>
  lastDispatches: WpsReloadDispatch[]
  lastReloadResults: WpsReloadResult[]
  lastCloseResults: WpsCloseResult[]
  lastAddonFetches: WpsAddonFetch[]
}

type WpsAddonReport = {
  kind?: string
  component?: string
  at?: number
  data?: {
    items?: WpsOpenDocument[]
    ok?: boolean
    fullName?: string
    excerpt?: string
    reason?: string
    targetPath?: string
    remaining?: number
  }
}

export type WpsSyncServiceOptions = {
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
  at: number
  reopen: PendingReopen
  shellUsed: boolean
  excerptSent?: boolean
  timer?: ReturnType<typeof setTimeout>
}

type ReleasedClose = {
  component: string
  remaining: number
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

  public constructor(options: WpsSyncServiceOptions = {}) {
    this.installer =
      options.installer ??
      new WpsAddonInstaller({
        addonSourceDir: resolveAddonSourceDir(options.addonSourceDir)
      })
    this.preferredPort = options.preferredPort ?? WPS_PREFERRED_SYNC_PORT
    this.skipInstall = options.skipInstall ?? shouldSkipWpsInstall()
    this.addonSourceDir = resolveAddonSourceDir(options.addonSourceDir)
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

    if (!this.skipInstall && this.preferredPort > 0 && (await probeWpsSyncPort(this.preferredPort))) {
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
    if (!this.server || this.clients.size === 0) return false
    const resolvedPath = path.resolve(filePath)
    if (!this.registry.isOpen(resolvedPath)) return false
    const component = this.registry.componentFor(resolvedPath) || 'unknown'
    const startedAt = Date.now()
    this.broadcast({ type: 'close', path: resolvedPath }, component)
    const deadline = startedAt + CLOSE_WAIT_MS
    while (Date.now() < deadline) {
      const closed = this.findCloseResult(resolvedPath, startedAt)
      if (closed) {
        this.registry.remove(resolvedPath)
        this.releasedCloses.set(normalizeOfficePath(resolvedPath), {
          component: closed.component || component,
          remaining: closed.remaining
        })
        return true
      }
      if (!this.hasComponentClient(component)) {
        this.registry.remove(resolvedPath)
        this.releasedCloses.set(normalizeOfficePath(resolvedPath), { component, remaining: 0 })
        return true
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CLOSE_POLL_MS)
      })
    }
    return false
  }

  public notifyWritten(filePath: string): void {
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
    if (!released && this.clients.size === 0) return
    const component =
      released && released.component !== 'unknown'
        ? released.component
        : officeWriteHostForPath(resolvedPath) || 'unknown'
    this.clearPendingOpen(resolvedPath)
    this.pendingOpens.set(key, {
      path: resolvedPath,
      component,
      at: Date.now(),
      reopen: 'addin',
      shellUsed: false
    })
    // 加载项卸载后 SSE 可能仍连着，只有它自报的剩余文档数能说明还能不能 Open。
    if (released && released.remaining <= 0) {
      this.startShellReopen(resolvedPath)
      return
    }
    if (!this.hasComponentClient(component)) {
      if (released) this.startShellReopen(resolvedPath)
      return
    }
    this.startAddonReopen(resolvedPath, component)
  }

  public async stop(): Promise<void> {
    this.stopped = true
    const ownedPort = this.port
    for (const client of this.clients) {
      try {
        client.response.end()
      } catch {
        // 关闭时忽略已断开的客户端。
      }
    }
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
    if (
      ownedPort === undefined ||
      this.preferredPort <= 0 ||
      ownedPort === this.preferredPort
    ) {
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
      if (code !== 'EADDRINUSE') throw error
      if (!this.skipInstall && this.preferredPort > 0 && (await probeWpsSyncPort(this.preferredPort))) {
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

  private hasComponentClient(component: string): boolean {
    if (component === 'unknown') return this.clients.size > 0
    return [...this.clients].some((client) => client.component === component)
  }

  private reopenReleasedPath(resolvedPath: string, component: string): void {
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

  private startAddonReopen(resolvedPath: string, component: string): void {
    const pending = this.pendingOpens.get(normalizeOfficePath(resolvedPath))
    if (!pending) return
    pending.reopen = 'addin'
    this.broadcast(
      { type: 'open', path: resolvedPath },
      component === 'unknown' ? undefined : component
    )
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
      if (pending.excerptSent || Date.now() >= deadline) return
      this.broadcast(
        { type: 'list' },
        pending.component === 'unknown' ? undefined : pending.component
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
      if (!this.registry.isOpen(pending.path)) continue
      if (!this.hasComponentClient(pending.component)) continue
      pending.excerptSent = true
      this.broadcast(
        { type: 'excerpt', path: pending.path },
        pending.component === 'unknown' ? undefined : pending.component
      )
    }
  }

  private broadcast(payload: unknown, component?: string): void {
    for (const client of this.clients) {
      if (component && client.component !== component) continue
      try {
        writeSse(client.response, payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  private flushPendingOpens(client: SseClient): void {
    for (const pending of this.pendingOpens.values()) {
      if (pending.component !== 'unknown' && pending.component !== client.component) continue
      if (pending.reopen !== 'addin') continue
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

  private fallbackFailedOpen(component: string, filePath: string | undefined): void {
    if (!filePath) return
    const pending = this.pendingOpens.get(normalizeOfficePath(filePath))
    if (!pending || pending.reopen !== 'addin' || pending.shellUsed) return
    if (pending.component !== 'unknown' && pending.component !== component) return
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
      this.acceptSse(request, response, url.searchParams.get('component') || 'unknown')
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
        if (Array.isArray(body.data?.items)) {
          this.registry.setDocuments(component, body.data.items)
          this.completeShellOpens()
        }
        if (body.kind === 'close-result') {
          const fullName = String(body.data?.fullName || '')
          const targetPath = body.data?.targetPath ? String(body.data.targetPath) : undefined
          const ok = body.data?.ok === true
          this.pushCapped(this.lastCloseResults, {
            at: typeof body.at === 'number' ? body.at : Date.now(),
            component,
            ok,
            fullName,
            remaining: Math.max(0, Number(body.data?.remaining) || 0),
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
            ok,
            fullName,
            excerpt: String(body.data?.excerpt || ''),
            reason: body.data?.reason ? String(body.data.reason) : undefined,
            targetPath
          })
          if (ok) {
            this.clearPendingOpen(fullName)
            this.clearPendingOpen(targetPath)
            if (fullName || targetPath) this.registry.upsert(component, fullName || targetPath || '')
          } else {
            this.fallbackFailedOpen(component, targetPath || fullName)
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
        item.ok &&
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
      clients: [...this.clients].map((client) => ({ component: client.component })),
      openDocuments: this.registry.listOpenDocuments(),
      lastDispatches: [...this.lastDispatches],
      lastReloadResults: [...this.lastReloadResults],
      lastCloseResults: [...this.lastCloseResults],
      lastAddonFetches: [...this.lastAddonFetches]
    }
  }

  private acceptSse(request: IncomingMessage, response: ServerResponse, component: string): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })
    const client: SseClient = { response, component }
    this.clients.add(client)
    writeSse(response, { type: 'ping' })
    writeSse(response, { type: 'list' })
    this.flushPendingOpens(client)
    request.on('close', () => {
      this.clients.delete(client)
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

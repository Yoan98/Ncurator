import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { WPS_ADDON_FILES, WPS_PREFERRED_SYNC_PORT } from './constants'
import { WpsAddonInstaller, type WpsAddonInstallerLike } from './WpsAddonInstaller'
import { normalizeOfficePath } from './officeFileWriteNotify'

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

export type WpsSyncStatus = {
  ok: true
  clientCount: number
  clients: Array<{ component: string }>
  openDocuments: Array<{ component: string; fullName: string }>
  lastDispatches: WpsReloadDispatch[]
  lastReloadResults: WpsReloadResult[]
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

  public notifyWritten(filePath: string): void {
    if (!this.server) return
    const resolvedPath = path.resolve(filePath)
    this.pushCapped(this.lastDispatches, {
      path: resolvedPath,
      at: Date.now(),
      clientCount: this.clients.size
    })
    if (this.clients.size === 0) return
    this.broadcast({ type: 'reload', path: resolvedPath })
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

  private broadcast(payload: unknown): void {
    for (const client of this.clients) {
      try {
        writeSse(client.response, payload)
      } catch {
        this.clients.delete(client)
      }
    }
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
        }
        if (body.kind === 'reload-result') {
          this.pushCapped(this.lastReloadResults, {
            at: typeof body.at === 'number' ? body.at : Date.now(),
            component,
            ok: body.data?.ok === true,
            fullName: String(body.data?.fullName || ''),
            excerpt: String(body.data?.excerpt || ''),
            reason: body.data?.reason ? String(body.data.reason) : undefined,
            targetPath: body.data?.targetPath ? String(body.data.targetPath) : undefined
          })
        }
        sendJson(response, 200, { ok: true })
      } catch {
        sendJson(response, 400, { ok: false })
      }
      return
    }

    sendJson(response, 404, { ok: false })
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

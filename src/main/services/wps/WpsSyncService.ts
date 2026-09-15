import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { app } from 'electron'
import { WPS_PREFERRED_SYNC_PORT } from './constants'
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

  public clear(): void {
    this.byComponent.clear()
  }
}

type SseClient = {
  response: ServerResponse
  component: string
}

export type WpsSyncServiceOptions = {
  installer?: WpsAddonInstallerLike
  addonSourceDir?: string
  preferredPort?: number
  skipInstall?: boolean
}

const MAX_REPORT_BYTES = 1024 * 1024

const isLoopbackHost = (host: string): boolean =>
  host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host === '127.0.0.1'

const resolveAddonSourceDir = (override?: string): string => {
  if (override) return override
  if (app.isPackaged) return path.join(process.resourcesPath, 'wps-addon')
  return path.join(process.cwd(), 'resources', 'wps-addon')
}

const shouldSkipWpsInstall = (): boolean => process.env.NCURATOR_E2E_OBSERVER === '1'

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
  private readonly registry = new WpsOpenDocumentRegistry()
  private readonly clients = new Set<SseClient>()
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
  }

  public getPort(): number | undefined {
    return this.port
  }

  public getOpenRegistry(): WpsOpenDocumentRegistry {
    return this.registry
  }

  public async start(): Promise<void> {
    if (this.server || this.stopped) return
    let installed = false
    if (!this.skipInstall) {
      const result = await this.installer.install().catch((error: unknown) => {
        console.warn(
          '[WPS-SYNC] addon install skipped:',
          error instanceof Error ? error.message : String(error)
        )
        return { installed: false as const, reason: 'install-failed' }
      })
      if (!result.installed) return
      installed = true
    }

    await this.listen()
    if (this.stopped) {
      await this.stop()
      return
    }
    if (!installed || this.port === undefined) return
    await this.installer.writePort(this.port).catch((error: unknown) => {
      console.warn(
        '[WPS-SYNC] failed to write port.json:',
        error instanceof Error ? error.message : String(error)
      )
    })
  }

  public notifyWritten(filePath: string): void {
    if (!this.server || this.clients.size === 0) return
    this.broadcast({ type: 'reload', path: path.resolve(filePath) })
  }

  public async stop(): Promise<void> {
    this.stopped = true
    for (const client of this.clients) {
      try {
        client.response.end()
      } catch {
        // 关闭时忽略已断开的客户端。
      }
    }
    this.clients.clear()
    this.registry.clear()
    const server = this.server
    this.server = undefined
    this.port = undefined
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  private async listen(): Promise<void> {
    this.server = createServer((request, response) => {
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
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE') throw error
      this.port = await bind(0)
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

    if (request.method === 'POST' && url.pathname === '/report') {
      try {
        const body = JSON.parse(await readRequestBody(request)) as {
          component?: string
          data?: { items?: WpsOpenDocument[] }
        }
        if (Array.isArray(body.data?.items)) {
          this.registry.setDocuments(String(body.component || 'unknown'), body.data.items)
        }
        sendJson(response, 200, { ok: true })
      } catch {
        sendJson(response, 400, { ok: false })
      }
      return
    }

    sendJson(response, 404, { ok: false })
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
}

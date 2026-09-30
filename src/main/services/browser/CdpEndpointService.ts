import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createWebSocketAcceptKey, LoopbackWebSocket } from './cdpWebSocket'

export type CdpEndpoint = {
  port: number
  httpOrigin: string
  browserWebSocketUrl: string
}

export type CdpDebuggerLike = {
  attach: (protocolVersion?: string) => void
  detach: () => void
  isAttached: () => boolean
  sendCommand: (method: string, commandParams?: unknown, sessionId?: string) => Promise<unknown>
  on: (event: 'message' | 'detach', listener: (...args: unknown[]) => void) => unknown
  off: (event: 'message' | 'detach', listener: (...args: unknown[]) => void) => unknown
}

export type CdpDebuggableContents = {
  id: number
  isDestroyed: () => boolean
  getURL: () => string
  getTitle: () => string
  debugger: CdpDebuggerLike
  once: (event: 'destroyed', listener: () => void) => unknown
  removeListener: (event: 'destroyed', listener: () => void) => unknown
}

type CdpJsonRpcRequest = {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  sessionId?: string
}

type RegisteredTarget = {
  targetId: string
  contents: CdpDebuggableContents
  attachedDebugger: boolean
  onMessage: (...args: unknown[]) => void
  onDetach: (...args: unknown[]) => void
  onDestroyed: () => void
}

type PageSession = {
  sessionId: string
  targetId: string
  electronSessionId?: string
}

const DEFAULT_CHROME_VERSION = '0.0.0.0'

const chromeVersion = (): string => String(process.versions.chrome || DEFAULT_CHROME_VERSION)

const browserUserAgent = (): string =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion()} Safari/537.36`

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const readString = (value: unknown): string => (typeof value === 'string' ? value : '')

export class CdpEndpointService {
  private readonly browserId = randomUUID()
  private readonly browserContextId = randomUUID()
  private readonly targets = new Map<string, RegisteredTarget>()
  private readonly clients = new Set<BrowserCdpClient>()
  private server: Server | null = null
  private listenPromise: Promise<CdpEndpoint> | null = null
  private endpoint: CdpEndpoint | null = null
  private closed = false

  public async getEndpoint(): Promise<CdpEndpoint> {
    if (this.closed) throw new Error('embedded_browser_cdp_unavailable: bridge closed')
    this.listenPromise ||= this.startListening().catch((error) => {
      this.listenPromise = null
      throw error
    })
    return this.listenPromise
  }

  public async getScopedEndpoint(targetId: string): Promise<CdpEndpoint> {
    if (!this.targets.has(targetId)) throw new Error('CDP target not registered')
    const endpoint = await this.getEndpoint()
    return {
      ...endpoint,
      browserWebSocketUrl: `${endpoint.browserWebSocketUrl}?target=${encodeURIComponent(targetId)}`
    }
  }

  public registerTarget(contents: CdpDebuggableContents): string {
    if (this.closed) throw new Error('embedded_browser_cdp_unavailable: bridge closed')
    if (contents.isDestroyed()) throw new Error('embedded browser CDP target was destroyed')
    for (const target of this.targets.values()) {
      if (target.contents.id === contents.id) return target.targetId
    }

    const targetId = randomUUID()
    const target: RegisteredTarget = {
      targetId,
      contents,
      attachedDebugger: false,
      onMessage: (...args: unknown[]) => this.handleDebuggerMessage(targetId, args),
      onDetach: () => this.unregisterTarget(targetId),
      onDestroyed: () => this.unregisterTarget(targetId)
    }
    this.attachDebugger(target)
    this.targets.set(targetId, target)
    contents.once('destroyed', target.onDestroyed)
    this.broadcastTargetCreated(target)
    return targetId
  }

  public unregisterTarget(targetId: string): void {
    const target = this.targets.get(targetId)
    if (!target) return
    this.targets.delete(targetId)
    try {
      target.contents.removeListener('destroyed', target.onDestroyed)
    } catch {
      // Contents may already be gone.
    }
    this.detachDebugger(target)
    for (const client of this.clients) client.forgetTarget(targetId)
    this.broadcast({
      method: 'Target.targetDestroyed',
      params: { targetId }
    })
  }

  public unregisterContents(contents: { id: number }): void {
    for (const [targetId, target] of this.targets) {
      if (target.contents.id === contents.id) this.unregisterTarget(targetId)
    }
  }

  public async dispose(): Promise<void> {
    this.closed = true
    for (const targetId of [...this.targets.keys()]) this.unregisterTarget(targetId)
    for (const client of [...this.clients]) client.close()
    this.clients.clear()
    const server = this.server
    this.server = null
    this.endpoint = null
    this.listenPromise = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  private attachDebugger(target: RegisteredTarget): void {
    const debug = target.contents.debugger
    try {
      if (!debug.isAttached()) debug.attach('1.3')
    } catch (error) {
      if (!debug.isAttached()) {
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
    target.attachedDebugger = debug.isAttached()
    debug.on('message', target.onMessage)
    debug.on('detach', target.onDetach)
  }

  private detachDebugger(target: RegisteredTarget): void {
    const debug = target.contents.debugger
    debug.off('message', target.onMessage)
    debug.off('detach', target.onDetach)
    if (!target.attachedDebugger || target.contents.isDestroyed()) return
    try {
      if (debug.isAttached()) debug.detach()
    } catch {
      return
    }
  }

  private handleDebuggerMessage(targetId: string, args: unknown[]): void {
    const method = readString(args[1])
    if (!method) return
    const params = args[2]
    const electronSessionId = readString(args[3])
    for (const client of this.clients) {
      client.forwardDebuggerEvent(targetId, method, params, electronSessionId)
    }
  }

  private async startListening(): Promise<CdpEndpoint> {
    if (this.endpoint) return this.endpoint
    const server = createServer((request, response) => {
      void this.handleHttp(request, response)
    })
    server.on('upgrade', (request, socket) => {
      this.handleUpgrade(request, socket)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('embedded_browser_cdp_unavailable: failed to bind loopback port')
    }
    this.server = server
    const port = address.port
    this.endpoint = {
      port,
      httpOrigin: `http://127.0.0.1:${String(port)}`,
      browserWebSocketUrl: `ws://127.0.0.1:${String(port)}/devtools/browser/${this.browserId}`
    }
    return this.endpoint
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname =
      new URL(request.url || '/', 'http://127.0.0.1').pathname.replace(/\/$/u, '') || '/'
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return
    }
    if (pathname === '/json/version') {
      this.writeJson(response, this.versionPayload())
      return
    }
    if (pathname === '/json/list' || pathname === '/json') {
      this.writeJson(response, this.listPayload())
      return
    }
    response.writeHead(404).end()
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const key = readString(request.headers['sec-websocket-key'])
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
    const pathname = requestUrl.pathname
    const scopedTargetId = requestUrl.searchParams.get('target')
    const isBrowserPath = pathname === `/devtools/browser/${this.browserId}`
    const pageTargetId = pathname.startsWith('/devtools/page/')
      ? pathname.slice('/devtools/page/'.length)
      : ''
    if (
      !key ||
      (scopedTargetId && !this.targets.has(scopedTargetId)) ||
      (!isBrowserPath && !this.targets.has(pageTargetId))
    ) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${createWebSocketAcceptKey(key)}`,
        '',
        ''
      ].join('\r\n')
    )
    const ws = new LoopbackWebSocket(socket)
    const client = new BrowserCdpClient(this, ws, pageTargetId || scopedTargetId || null)
    this.clients.add(client)
    ws.onClose(() => this.clients.delete(client))
  }

  private writeJson(response: ServerResponse, payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length
    })
    response.end(body)
  }

  private versionPayload(): Record<string, string> {
    const endpoint = this.endpoint
    return {
      Browser: `Chrome/${chromeVersion()}`,
      'Protocol-Version': '1.3',
      'User-Agent': browserUserAgent(),
      'V8-Version': String(process.versions.v8 || ''),
      'WebKit-Version': '0',
      webSocketDebuggerUrl: endpoint?.browserWebSocketUrl || ''
    }
  }

  public listPayload(): Array<Record<string, string>> {
    const origin = this.endpoint?.httpOrigin.replace('http://', '') || '127.0.0.1'
    return [...this.targets.values()].map((target) => {
      const wsUrl = `ws://${origin}/devtools/page/${target.targetId}`
      return {
        description: '',
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=${origin}/devtools/page/${target.targetId}`,
        id: target.targetId,
        title: this.safeTitle(target),
        type: 'page',
        url: this.safeUrl(target),
        webSocketDebuggerUrl: wsUrl
      }
    })
  }

  public listTargetInfos(attachedIds: Set<string>): Array<Record<string, unknown>> {
    return [...this.targets.values()].map((target) =>
      this.toTargetInfo(target, attachedIds.has(target.targetId))
    )
  }

  public getTarget(targetId: string): RegisteredTarget | undefined {
    return this.targets.get(targetId)
  }

  public firstTargetId(): string | undefined {
    return this.targets.keys().next().value
  }

  public toTargetInfo(target: RegisteredTarget, attached: boolean): Record<string, unknown> {
    return {
      targetId: target.targetId,
      type: 'page',
      title: this.safeTitle(target),
      url: this.safeUrl(target),
      attached,
      canAccessOpener: false,
      browserContextId: this.browserContextId
    }
  }

  public sendCommand(
    target: RegisteredTarget,
    method: string,
    params: unknown,
    electronSessionId?: string
  ): Promise<unknown> {
    if (target.contents.isDestroyed()) {
      return Promise.reject(new Error('CDP target was destroyed'))
    }
    return target.contents.debugger.sendCommand(
      method,
      params ?? {},
      electronSessionId || undefined
    )
  }

  private safeUrl(target: RegisteredTarget): string {
    if (target.contents.isDestroyed()) return 'about:blank'
    try {
      return target.contents.getURL() || 'about:blank'
    } catch {
      return 'about:blank'
    }
  }

  private safeTitle(target: RegisteredTarget): string {
    if (target.contents.isDestroyed()) return ''
    try {
      return target.contents.getTitle() || ''
    } catch {
      return ''
    }
  }

  private broadcastTargetCreated(target: RegisteredTarget): void {
    const info = this.toTargetInfo(target, false)
    this.broadcast({ method: 'Target.targetCreated', params: { targetInfo: info } })
    for (const client of this.clients) client.autoAttachIfNeeded(target)
  }

  private broadcast(message: { method: string; params: unknown; sessionId?: string }): void {
    for (const client of this.clients)
      client.sendEvent(message.method, message.params, message.sessionId)
  }
}

class BrowserCdpClient {
  private readonly sessions = new Map<string, PageSession>()
  private readonly sessionsByTarget = new Map<string, string>()
  private autoAttach = false
  private discoverTargets = false

  public constructor(
    private readonly bridge: CdpEndpointService,
    private readonly socket: LoopbackWebSocket,
    private readonly preferredTargetId: string | null
  ) {
    socket.onMessage((data) => {
      void this.handleMessage(data)
    })
  }

  public close(): void {
    this.socket.close()
  }

  public forgetTarget(targetId: string): void {
    const sessionId = this.sessionsByTarget.get(targetId)
    if (!sessionId) return
    this.sessions.delete(sessionId)
    this.sessionsByTarget.delete(targetId)
    this.sendEvent('Target.detachedFromTarget', { sessionId, targetId })
  }

  public autoAttachIfNeeded(target: RegisteredTarget): void {
    if (
      !this.allowsTarget(target.targetId) ||
      !this.autoAttach ||
      this.sessionsByTarget.has(target.targetId)
    )
      return
    this.attachTarget(target, true)
  }

  public allowsTarget(targetId: string): boolean {
    return !this.preferredTargetId || this.preferredTargetId === targetId
  }

  private targetInfos(attachedIds: Set<string>): Array<Record<string, unknown>> {
    return this.bridge
      .listTargetInfos(attachedIds)
      .filter((info) => this.allowsTarget(String(info.targetId)))
  }

  public sendEvent(method: string, params: unknown, sessionId?: string): void {
    if (method.startsWith('Target.')) {
      const data = asRecord(params)
      const targetId = readString(data.targetId) || readString(asRecord(data.targetInfo).targetId)
      if (targetId && !this.allowsTarget(targetId)) return
    }
    this.emitEvent(method, params, sessionId)
  }

  private emitEvent(method: string, params: unknown, sessionId?: string): void {
    const payload: Record<string, unknown> = { method, params }
    if (sessionId) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
  }

  public forwardDebuggerEvent(
    targetId: string,
    method: string,
    params: unknown,
    electronSessionId: string
  ): void {
    const pageSessionId = this.sessionsByTarget.get(targetId)
    if (!pageSessionId) return
    const sessionId = electronSessionId || pageSessionId
    if (electronSessionId && !this.sessions.has(electronSessionId)) {
      this.sessions.set(electronSessionId, {
        sessionId: electronSessionId,
        targetId,
        electronSessionId
      })
    }
    // The source page session already passed the scope check; include its child frames.
    this.emitEvent(method, params, sessionId === pageSessionId ? pageSessionId : sessionId)
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: CdpJsonRpcRequest
    try {
      message = JSON.parse(raw) as CdpJsonRpcRequest
    } catch {
      return
    }
    const id = message.id
    if (id === undefined || !message.method) return
    try {
      const result = await this.dispatch(message)
      this.reply(id, result, message.sessionId)
    } catch (error) {
      this.replyError(id, error instanceof Error ? error.message : String(error), message.sessionId)
    }
  }

  private async dispatch(message: CdpJsonRpcRequest): Promise<unknown> {
    const method = message.method || ''
    const params = asRecord(message.params)
    if (message.sessionId) return this.dispatchSession(message.sessionId, method, params)
    return this.dispatchBrowser(method, params)
  }

  private async dispatchBrowser(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: `Chrome/${chromeVersion()}`,
          revision: '0',
          userAgent: browserUserAgent(),
          jsVersion: String(process.versions.v8 || '')
        }
      case 'Browser.getBrowserCommandLine':
        return { arguments: [] }
      case 'Browser.setDownloadBehavior':
      case 'Browser.setWindowBounds':
      case 'Browser.close':
        return {}
      case 'Browser.getWindowForTarget':
        return {
          windowId: 1,
          bounds: { left: 0, top: 0, width: 1280, height: 800, windowState: 'normal' }
        }
      case 'Target.setDiscoverTargets':
        this.discoverTargets = Boolean(params.discover)
        if (this.discoverTargets) {
          for (const info of this.targetInfos(new Set(this.sessionsByTarget.keys()))) {
            this.sendEvent('Target.targetCreated', { targetInfo: info })
          }
        }
        return {}
      case 'Target.setAutoAttach':
        this.autoAttach = Boolean(params.autoAttach)
        if (this.autoAttach) {
          for (const target of this.targetInfos(new Set()).map((info) =>
            this.bridge.getTarget(String(info.targetId || ''))
          )) {
            if (target) this.autoAttachIfNeeded(target)
          }
        }
        return {}
      case 'Target.getTargets':
        return { targetInfos: this.targetInfos(new Set(this.sessionsByTarget.keys())) }
      case 'Target.attachToTarget': {
        const target = this.bridge.getTarget(readString(params.targetId))
        if (!target || !this.allowsTarget(target.targetId))
          throw new Error('No target with given id found')
        const session = this.attachTarget(target, true)
        return { sessionId: session.sessionId }
      }
      case 'Target.detachFromTarget': {
        const sessionId = readString(params.sessionId)
        const session = this.sessions.get(sessionId)
        if (session) this.forgetTarget(session.targetId)
        return {}
      }
      case 'Target.getTargetInfo': {
        const targetId =
          readString(params.targetId) || this.preferredTargetId || this.bridge.firstTargetId() || ''
        const target = this.bridge.getTarget(targetId)
        if (!target || !this.allowsTarget(target.targetId))
          throw new Error('No target with given id found')
        return {
          targetInfo: this.bridge.toTargetInfo(target, this.sessionsByTarget.has(targetId))
        }
      }
      case 'Target.activateTarget':
      case 'Target.setRemoteLocations':
        return {}
      case 'Target.closeTarget':
        return { success: true }
      case 'Target.createTarget': {
        const existing = this.preferredTargetId || this.bridge.firstTargetId()
        if (!existing) throw new Error('No CDP target is registered')
        return { targetId: existing }
      }
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] }
      case 'Target.createBrowserContext':
        return { browserContextId: randomUUID() }
      case 'Target.disposeBrowserContext':
        return {}
      default:
        throw new Error(`'${method}' wasn't found`)
    }
  }

  private async dispatchSession(
    sessionId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const target = this.bridge.getTarget(session.targetId)
    if (!target || !this.allowsTarget(target.targetId))
      throw new Error('No target with given id found')
    if (method === 'Runtime.runIfWaitingForDebugger') {
      try {
        return (
          (await this.bridge.sendCommand(target, method, params, session.electronSessionId)) ?? {}
        )
      } catch {
        return {}
      }
    }
    const result = await this.bridge.sendCommand(target, method, params, session.electronSessionId)
    return result ?? {}
  }

  private attachTarget(target: RegisteredTarget, waitingForDebugger: boolean): PageSession {
    const existing = this.sessionsByTarget.get(target.targetId)
    if (existing) {
      const session = this.sessions.get(existing)
      if (session) return session
    }
    const sessionId = randomUUID()
    const session: PageSession = { sessionId, targetId: target.targetId }
    this.sessions.set(sessionId, session)
    this.sessionsByTarget.set(target.targetId, sessionId)
    this.sendEvent('Target.attachedToTarget', {
      sessionId,
      waitingForDebugger,
      targetInfo: this.bridge.toTargetInfo(target, true)
    })
    return session
  }

  private reply(id: number | string, result: unknown, sessionId?: string): void {
    const payload: Record<string, unknown> = { id, result: result ?? {} }
    if (sessionId) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
  }

  private replyError(id: number | string, message: string, sessionId?: string): void {
    const payload: Record<string, unknown> = {
      id,
      error: { code: -32601, message }
    }
    if (sessionId) payload.sessionId = sessionId
    this.socket.send(JSON.stringify(payload))
  }
}

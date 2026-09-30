import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import type { CdpDebuggableContents, CdpEndpointService } from '../browser/CdpEndpointService'

export type WebCrawlerCdpConnection = {
  browserWebSocketUrl: string
  contextMarkerUrl: string
}

const WEB_CRAWLER_HOST_LOAD_TIMEOUT_MS = 15_000
const WEB_CRAWLER_HOST_VIEW_BOUNDS = { x: 0, y: 0, width: 1, height: 1 }
const WEB_CRAWLER_HOST_OFFSCREEN_POSITION = { x: -20_000, y: -20_000 }

const waitForWebContentsLoad = async (
  contents: WebContents,
  url: string,
  timeoutMs = WEB_CRAWLER_HOST_LOAD_TIMEOUT_MS
): Promise<void> => {
  if (contents.isDestroyed()) {
    throw new Error('Electron web crawler browser host was destroyed before navigation')
  }
  if (!contents.isLoadingMainFrame() && contents.getURL() === url) return

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Electron web crawler marker page load timed out: ${url}`)),
      timeoutMs
    )
    const cleanup = (): void => {
      clearTimeout(timeout)
      contents.removeListener('did-finish-load', onDone)
      contents.removeListener('did-stop-loading', onDone)
      contents.removeListener('did-fail-load', onFail)
      contents.removeListener('destroyed', onDestroyed)
    }
    const finish = (error?: Error): void => {
      cleanup()
      error ? reject(error) : resolve()
    }
    const onDone = (): void => {
      if (contents.getURL() === url || contents.getURL().startsWith('about:blank')) {
        finish()
      }
    }
    const onFail = (_event: Electron.Event, _code: number, description: string): void =>
      finish(new Error(description || 'Electron web crawler marker page load failed'))
    const onDestroyed = (): void =>
      finish(new Error('Electron web crawler browser host was destroyed'))
    contents.once('did-finish-load', onDone)
    contents.once('did-stop-loading', onDone)
    contents.once('did-fail-load', onFail)
    contents.once('destroyed', onDestroyed)
    void contents.loadURL(url).catch((error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

export class ElectronWebCrawlerBrowserHost {
  private view: WebContentsView | null = null
  private hostWindow: BrowserWindow | null = null
  private connectionPromise: Promise<WebCrawlerCdpConnection> | null = null
  private registeredTargetId: string | null = null
  private closed = false

  public constructor(private readonly cdpEndpointService: CdpEndpointService) {}

  public getConnection(): Promise<WebCrawlerCdpConnection> {
    if (this.closed) {
      throw new Error('Electron web crawler browser host is closed')
    }
    this.connectionPromise ||= this.createConnection().catch((error) => {
      this.connectionPromise = null
      this.closeView()
      throw error
    })
    return this.connectionPromise
  }

  public async close(): Promise<void> {
    this.closed = true
    this.connectionPromise = null
    this.closeView()
  }

  private ensureHostWindow(): BrowserWindow {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      return this.hostWindow
    }

    const hostWindow = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      frame: false,
      width: WEB_CRAWLER_HOST_VIEW_BOUNDS.width,
      height: WEB_CRAWLER_HOST_VIEW_BOUNDS.height,
      x: WEB_CRAWLER_HOST_OFFSCREEN_POSITION.x,
      y: WEB_CRAWLER_HOST_OFFSCREEN_POSITION.y,
      focusable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    hostWindow.setPosition(
      WEB_CRAWLER_HOST_OFFSCREEN_POSITION.x,
      WEB_CRAWLER_HOST_OFFSCREEN_POSITION.y,
      false
    )
    this.hostWindow = hostWindow
    return hostWindow
  }

  private async createConnection(): Promise<WebCrawlerCdpConnection> {
    const contextMarkerUrl = `about:blank#ncurator-web-crawler-${randomUUID()}`
    const hostWindow = this.ensureHostWindow()
    const view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: `ncurator-web-crawler-${randomUUID()}`
      }
    })
    this.view = view
    hostWindow.contentView.addChildView(view)
    view.setBounds(WEB_CRAWLER_HOST_VIEW_BOUNDS)
    await waitForWebContentsLoad(view.webContents, contextMarkerUrl)
    this.registeredTargetId = this.cdpEndpointService.registerTarget(
      view.webContents as CdpDebuggableContents
    )
    const endpoint = await this.cdpEndpointService.getScopedEndpoint(this.registeredTargetId)
    if (this.closed) {
      throw new Error('Electron web crawler browser host is closed')
    }
    return {
      browserWebSocketUrl: endpoint.browserWebSocketUrl,
      contextMarkerUrl
    }
  }

  private closeView(): void {
    if (this.registeredTargetId) {
      this.cdpEndpointService.unregisterTarget(this.registeredTargetId)
      this.registeredTargetId = null
    }
    const view = this.view
    this.view = null
    if (view && !view.webContents.isDestroyed()) {
      const hostWindow = this.hostWindow
      if (hostWindow && !hostWindow.isDestroyed()) {
        try {
          hostWindow.contentView.removeChildView(view)
        } catch {
          // The host window may already be closing during app shutdown.
        }
      }
      view.webContents.close()
    }

    const hostWindow = this.hostWindow
    this.hostWindow = null
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.destroy()
    }
  }
}

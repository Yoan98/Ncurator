import { randomUUID } from 'node:crypto'
import { WebContentsView } from 'electron'
import type { CdpEndpointService } from '../browser/CdpEndpointService'

export type WebCrawlerCdpConnection = {
  browserWebSocketUrl: string
  contextMarkerUrl: string
}

export class ElectronWebCrawlerBrowserHost {
  private view: WebContentsView | null = null
  private connectionPromise: Promise<WebCrawlerCdpConnection> | null = null
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

  private async createConnection(): Promise<WebCrawlerCdpConnection> {
    const contextMarkerUrl = `about:blank#ncurator-web-crawler-${randomUUID()}`
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
    await view.webContents.loadURL(contextMarkerUrl)
    const endpoint = await this.cdpEndpointService.getEndpoint()
    if (this.closed) {
      throw new Error('Electron web crawler browser host is closed')
    }
    return {
      browserWebSocketUrl: endpoint.browserWebSocketUrl,
      contextMarkerUrl
    }
  }

  private closeView(): void {
    const view = this.view
    this.view = null
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.close()
    }
  }
}

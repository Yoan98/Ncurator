import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createServer, type Server } from 'node:http'
import { drawingRenderResultSchema, type DrawingRenderResult } from './protocol'
import { CdpEndpointService, type CdpDebuggableContents } from '../../browser/CdpEndpointService'

let endpointService: CdpEndpointService | undefined
export const configureDrawingHost = (service: CdpEndpointService): void => {
  endpointService = service
}

/** A task owns one isolated renderer. The CLI cannot enumerate user browser tabs. */
export class ElectronDrawingHost {
  private window?: BrowserWindow
  private targetId?: string
  private receiptServer?: Server

  async open(onRendered?: (result: DrawingRenderResult) => void): Promise<Record<string, string>> {
    if (!endpointService) throw new Error('Drawing host is not initialized')
    if (this.window) throw new Error('Drawing host is already open')
    this.window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      frame: false,
      focusable: false,
      width: 1280,
      height: 720,
      x: -20000,
      y: -20000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: `drawing-${randomUUID()}`
      }
    })
    const marker = `about:blank#ncurator-drawing-${randomUUID()}`
    await this.window.loadURL(marker)
    this.targetId = await endpointService.registerTarget(
      this.window.webContents as CdpDebuggableContents
    )
    const endpoint = await endpointService.getScopedEndpoint(this.targetId)
    const environment = {
      NCURATOR_DRAWING_CDP: endpoint.browserWebSocketUrl,
      NCURATOR_DRAWING_MARKER: marker
    }
    if (!onRendered) return environment
    const route = `/${randomUUID()}`
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== route) {
        response.writeHead(404).end()
        return
      }
      try {
        request.setEncoding('utf8')
        let body = ''
        for await (const chunk of request) {
          body += String(chunk)
          if (body.length > 16384) throw new Error('Drawing receipt is too large')
        }
        onRendered(drawingRenderResultSchema.parse(JSON.parse(body)))
        response.writeHead(204).end()
      } catch (error) {
        response.writeHead(400).end(error instanceof Error ? error.message : String(error))
      }
    })
    this.receiptServer = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Drawing receipt server unavailable')
    return { ...environment, NCURATOR_DRAWING_RECEIPT: `http://127.0.0.1:${address.port}${route}` }
  }

  close(): void {
    this.receiptServer?.closeAllConnections()
    this.receiptServer?.close()
    this.receiptServer = undefined
    if (this.targetId) endpointService?.unregisterTarget(this.targetId)
    this.targetId = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }
}

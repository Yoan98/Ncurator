import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { CdpEndpointService, type CdpDebuggableContents } from '../../browser/CdpEndpointService'

let endpointService: CdpEndpointService | undefined
export const configureDrawingHost = (service: CdpEndpointService): void => {
  endpointService = service
}

/** A task owns one isolated renderer. The CLI cannot enumerate user browser tabs. */
export class ElectronDrawingHost {
  private window?: BrowserWindow
  private targetId?: string

  async open(): Promise<Record<string, string>> {
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
    return { NCURATOR_DRAWING_CDP: endpoint.browserWebSocketUrl, NCURATOR_DRAWING_MARKER: marker }
  }

  close(): void {
    if (this.targetId) endpointService?.unregisterTarget(this.targetId)
    this.targetId = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }
}

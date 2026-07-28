import { BrowserWindow, screen } from 'electron'
import type { BrowserTabState } from '../../../shared/types'

type BrowserMenuActions = {
  zoomIn: () => BrowserTabState
  zoomOut: () => BrowserTabState
  zoomReset: () => BrowserTabState
  openExternal: () => void
}

type BrowserMenuOpenOptions = {
  x: number
  y: number
  state: BrowserTabState
  actions: BrowserMenuActions
}

type ResourceMenuOpenOptions = {
  x: number
  y: number
  onSelect: (kind: 'file' | 'browser') => void
}

const MENU_WIDTH = 286
const MENU_HEIGHT = 116
const MIN_ZOOM_PERCENT = 50
const MAX_ZOOM_PERCENT = 200
const RESOURCE_MENU_WIDTH = 166
const RESOURCE_MENU_HEIGHT = 104

const renderMenuHtml = (state: BrowserTabState): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; navigate-to ncurator-browser-menu:"
    />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      body {
        padding: 8px;
        color: #37352f;
        font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .menu {
        width: 100%;
        height: 100%;
        overflow: hidden;
        border: 1px solid #e1e0dc;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 10px 28px rgba(15, 15, 15, 0.16);
      }
      .zoom-row { height: 51px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
      .label { color: #57554f; }
      .controls { height: 30px; display: flex; overflow: hidden; border: 1px solid #deddd9; border-radius: 7px; background: #fbfbfa; }
      .control {
        display: flex;
        height: 100%;
        min-width: 32px;
        align-items: center;
        justify-content: center;
        border: 0;
        color: #57554f;
        text-decoration: none;
        user-select: none;
      }
      .control:hover { background: #f1f1ef; color: #24231f; }
      .control[data-disabled="true"] { color: #c9c7c2; pointer-events: none; }
      .percent { min-width: 58px; border-right: 1px solid #deddd9; border-left: 1px solid #deddd9; font-variant-numeric: tabular-nums; }
      .separator { height: 1px; margin: 0 8px; background: #eeeeec; }
      .external {
        display: flex;
        height: 47px;
        align-items: center;
        margin: 0 5px;
        padding: 0 8px;
        border-radius: 6px;
        color: #37352f;
        text-decoration: none;
        user-select: none;
      }
      .external:hover { background: #f4f4f2; }
      .external[data-disabled="true"] { color: #c9c7c2; pointer-events: none; }
    </style>
  </head>
  <body>
    <div class="menu" role="menu" aria-label="更多浏览器操作">
      <div class="zoom-row">
        <span class="label">页面缩放</span>
        <div class="controls" data-testid="workbench-browser-zoom-controls">
          <a
            id="zoom-out"
            class="control"
            href="ncurator-browser-menu://zoom-out"
            target="_blank"
            aria-label="缩小页面"
            data-disabled="${state.zoomPercent <= MIN_ZOOM_PERCENT}"
          >−</a>
          <a
            id="zoom-reset"
            class="control percent"
            href="ncurator-browser-menu://zoom-reset"
            target="_blank"
            aria-label="恢复页面缩放为 100%"
          >${state.zoomPercent}%</a>
          <a
            id="zoom-in"
            class="control"
            href="ncurator-browser-menu://zoom-in"
            target="_blank"
            aria-label="放大页面"
            data-disabled="${state.zoomPercent >= MAX_ZOOM_PERCENT}"
          >+</a>
        </div>
      </div>
      <div class="separator"></div>
      <a
        class="external"
        href="ncurator-browser-menu://open-external"
        target="_blank"
        role="menuitem"
        data-disabled="${!state.url}"
      >在系统浏览器中打开</a>
    </div>
  </body>
</html>`

const renderResourceMenuHtml = (): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; navigate-to ncurator-resource-menu:"
    />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      body { padding: 8px; color: #37352f; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .menu { width: 100%; height: 100%; padding: 5px; border: 1px solid #e1e0dc; border-radius: 8px; background: #fff; box-shadow: 0 10px 28px rgba(15, 15, 15, 0.16); }
      a { display: flex; height: 37px; align-items: center; padding: 0 10px; border-radius: 6px; color: #37352f; text-decoration: none; user-select: none; }
      a:hover { background: #f4f4f2; }
    </style>
  </head>
  <body>
    <div class="menu" role="menu" aria-label="新增标签页">
      <a href="ncurator-resource-menu://file" target="_blank" role="menuitem">文件</a>
      <a href="ncurator-resource-menu://browser" target="_blank" role="menuitem">浏览器</a>
    </div>
  </body>
</html>`

export class BrowserMenuWindowService {
  private menuWindow: BrowserWindow | null = null
  private closeResolver: (() => void) | null = null

  public constructor(private readonly mainWindow: BrowserWindow) {
    this.mainWindow.on('move', this.close)
    this.mainWindow.on('resize', this.close)
    this.mainWindow.on('closed', this.close)
  }

  public async open(options: BrowserMenuOpenOptions): Promise<void> {
    const menuWindow = this.createWindow(options.x, options.y, MENU_WIDTH, MENU_HEIGHT)
    if (!menuWindow) return

    const updateZoom = (state: BrowserTabState): void => {
      if (menuWindow.isDestroyed()) return
      const script = `(() => {
        const percent = ${JSON.stringify(`${state.zoomPercent}%`)};
        document.getElementById('zoom-reset').textContent = percent;
        document.getElementById('zoom-out').dataset.disabled = String(${state.zoomPercent <= MIN_ZOOM_PERCENT});
        document.getElementById('zoom-in').dataset.disabled = String(${state.zoomPercent >= MAX_ZOOM_PERCENT});
      })()`
      void menuWindow.webContents.executeJavaScript(script).catch(() => undefined)
    }

    menuWindow.webContents.setWindowOpenHandler(({ url }) => {
      const action = new URL(url).hostname
      if (action === 'zoom-out') updateZoom(options.actions.zoomOut())
      if (action === 'zoom-reset') updateZoom(options.actions.zoomReset())
      if (action === 'zoom-in') updateZoom(options.actions.zoomIn())
      if (action === 'open-external') {
        options.actions.openExternal()
        this.close()
      }
      return { action: 'deny' }
    })
    await this.present(menuWindow, renderMenuHtml(options.state))
  }

  public async openResourceMenu(options: ResourceMenuOpenOptions): Promise<void> {
    const menuWindow = this.createWindow(
      options.x,
      options.y,
      RESOURCE_MENU_WIDTH,
      RESOURCE_MENU_HEIGHT
    )
    if (!menuWindow) return
    menuWindow.webContents.setWindowOpenHandler(({ url }) => {
      const action = new URL(url).hostname
      if (action === 'file' || action === 'browser') options.onSelect(action)
      this.close()
      return { action: 'deny' }
    })
    await this.present(menuWindow, renderResourceMenuHtml())
  }

  private createWindow(
    offsetX: number,
    offsetY: number,
    width: number,
    height: number
  ): BrowserWindow | null {
    this.close()
    if (this.mainWindow.isDestroyed()) return null
    const contentBounds = this.mainWindow.getContentBounds()
    const display = screen.getDisplayMatching(contentBounds)
    const desiredX = contentBounds.x + Math.round(offsetX)
    const desiredY = contentBounds.y + Math.round(offsetY)
    const x = Math.min(
      Math.max(display.workArea.x, desiredX),
      display.workArea.x + display.workArea.width - width
    )
    const y = Math.min(
      Math.max(display.workArea.y, desiredY),
      display.workArea.y + display.workArea.height - height
    )
    const menuWindow = new BrowserWindow({
      parent: this.mainWindow,
      width,
      height,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
    this.menuWindow = menuWindow
    return menuWindow
  }

  private async present(menuWindow: BrowserWindow, html: string): Promise<void> {
    const closed = new Promise<void>((resolve) => {
      this.closeResolver = resolve
    })
    menuWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.close()
    })
    menuWindow.once('closed', () => {
      if (this.menuWindow === menuWindow) this.menuWindow = null
      const resolve = this.closeResolver
      this.closeResolver = null
      resolve?.()
    })
    menuWindow.once('ready-to-show', () => {
      if (this.menuWindow !== menuWindow || menuWindow.isDestroyed()) return
      menuWindow.show()
      menuWindow.focus()
      setTimeout(() => {
        if (this.menuWindow !== menuWindow || menuWindow.isDestroyed()) return
        menuWindow.once('blur', this.close)
      }, 100)
    })
    try {
      await menuWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
    } catch {
      this.close()
    }
    await closed
  }

  public close = (): void => {
    const menuWindow = this.menuWindow
    const resolve = this.closeResolver
    this.menuWindow = null
    this.closeResolver = null
    if (!menuWindow || menuWindow.isDestroyed()) {
      resolve?.()
      return
    }
    menuWindow.destroy()
    resolve?.()
  }

  public dispose(): void {
    this.close()
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.removeListener('move', this.close)
      this.mainWindow.removeListener('resize', this.close)
      this.mainWindow.removeListener('closed', this.close)
    }
  }
}

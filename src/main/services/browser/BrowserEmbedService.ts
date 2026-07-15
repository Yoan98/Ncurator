import { shell, WebContentsView } from 'electron'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
import { z } from 'zod/v4'
import type { BrowserActionCandidate, BrowserUsePage, BrowserUseService } from '../ai/types'
import {
  EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS,
  EMBEDDED_BROWSER_PARTITION,
  EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT,
  EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS
} from './constants'
import type {
  BrowserPanelBoundsState,
  BrowserPanelState,
  BrowserUseRunInput,
  BrowserUseRunResult
} from './types'
import { resolveStagehandRuntimeModel } from '../llm/stagehandModel'
import { BrowserActionVisualizer } from './BrowserActionVisualizer'

type StagehandModule = typeof import('@browserbasehq/stagehand')
type StagehandInstance = InstanceType<StagehandModule['Stagehand']>

const normalizeUrl = (rawUrl: string): string => {
  const parsed = new URL(String(rawUrl || '').trim())
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('browser_use only supports http/https URL navigation')
  }
  return parsed.toString()
}

const waitForWebContentsLoad = async (webContents: WebContents): Promise<void> => {
  if (!webContents.isLoadingMainFrame()) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`browser navigation timed out after ${EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS}ms`))
    }, EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timeout)
      webContents.removeListener('did-finish-load', onDone)
      webContents.removeListener('did-stop-loading', onDone)
      webContents.removeListener('did-fail-load', onFail)
    }
    const onDone = (): void => {
      cleanup()
      resolve()
    }
    const onFail = (_event: Electron.Event, _errorCode: number, errorDescription: string): void => {
      cleanup()
      reject(new Error(errorDescription || 'browser navigation failed'))
    }
    webContents.once('did-finish-load', onDone)
    webContents.once('did-stop-loading', onDone)
    webContents.once('did-fail-load', onFail)
  })
}

const loadWebContentsUrl = async (webContents: WebContents, url: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error(`browser navigation timed out after ${EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS}ms`))
    }, EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timeout)
      webContents.removeListener('did-finish-load', onDone)
      webContents.removeListener('did-stop-loading', onDone)
      webContents.removeListener('did-fail-load', onFail)
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    const onDone = (): void => {
      finish()
    }
    const onFail = (
      _event: Electron.Event,
      _errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) return
      finish(new Error(errorDescription || 'browser navigation failed'))
    }

    webContents.once('did-finish-load', onDone)
    webContents.once('did-stop-loading', onDone)
    webContents.on('did-fail-load', onFail)
    void webContents.loadURL(url).catch((error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

const stringifyStagehandExtraction = (value: object): string => {
  if ('extraction' in value && typeof value.extraction === 'string') return value.extraction
  return JSON.stringify(value)
}

const toBrowserActionCandidate = (action: {
  description: string
  method?: string
  arguments?: string[]
}): BrowserActionCandidate => ({
  description: action.description,
  ...(action.method ? { method: action.method } : {}),
  ...(action.arguments ? { arguments: action.arguments } : {})
})

const toBrowserUsePage = (url: string, title?: string): BrowserUsePage => ({
  url,
  ...(title && title.trim() ? { title: title.trim() } : {})
})

const ZOOM_STEP = 0.1
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 2

const clampZoomFactor = (value: number): number =>
  Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, value))

const resolveInitialZoomFactor = (width: number): number => {
  if (width < 720) return 0.85
  if (width < 960) return 0.9
  return 1
}

export class BrowserEmbedService implements BrowserUseService {
  private readonly mainWindow: BrowserWindow
  private view: WebContentsView | null = null
  private bounds: BrowserPanelBoundsState = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  }
  private userAdjustedZoom = false
  private initialZoomApplied = false

  public constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  public async show(): Promise<void> {
    this.ensureView()
    this.bounds = {
      ...this.bounds,
      visible: true
    }
    this.applyBounds()
  }

  public hide(): void {
    this.bounds = {
      ...this.bounds,
      visible: false
    }
    this.applyBounds()
  }

  public setBounds(bounds: BrowserPanelBoundsState): void {
    this.bounds = bounds
    this.applyBounds()
    this.applyInitialZoomIfNeeded()
  }

  public async navigate(rawUrl: string): Promise<void> {
    const view = this.ensureView()
    const url = normalizeUrl(rawUrl)
    if (view.webContents.getURL() !== url) {
      await loadWebContentsUrl(view.webContents, url)
      return
    }
    await waitForWebContentsLoad(view.webContents)
  }

  public reload(): void {
    this.ensureView().webContents.reload()
  }

  public openExternal(): void {
    const url = this.view?.webContents.getURL()
    if (!url) return
    void shell.openExternal(url)
  }

  public getState(): BrowserPanelState {
    const webContents = this.view?.webContents
    if (!webContents || webContents.isDestroyed()) {
      return {
        url: '',
        zoomPercent: 100
      }
    }
    const title = webContents.getTitle().trim()
    return {
      url: webContents.getURL(),
      ...(title ? { title } : {}),
      zoomPercent: Math.round(webContents.getZoomFactor() * 100)
    }
  }

  public zoomIn(): BrowserPanelState {
    this.setZoomFactor(this.getCurrentZoomFactor() + ZOOM_STEP, true)
    return this.getState()
  }

  public zoomOut(): BrowserPanelState {
    this.setZoomFactor(this.getCurrentZoomFactor() - ZOOM_STEP, true)
    return this.getState()
  }

  public zoomReset(): BrowserPanelState {
    this.setZoomFactor(1, true)
    return this.getState()
  }

  public async run(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    await this.show()
    if (input.action === 'navigate') {
      if (!input.url) throw new Error('browser_use navigate requires url')
      await this.navigate(input.url)
      const view = this.ensureView()
      await waitForWebContentsLoad(view.webContents)
      return {
        action: 'navigate',
        page: toBrowserUsePage(view.webContents.getURL(), view.webContents.getTitle()),
        result: null
      }
    }
    if (input.url) {
      await this.navigate(input.url)
    }
    return await this.runDom(input)
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view

    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: EMBEDDED_BROWSER_PARTITION
      }
    })
    this.view.webContents.setWindowOpenHandler((details) => {
      void this.view?.webContents.loadURL(details.url)
      return { action: 'deny' }
    })
    this.view.webContents.on('did-navigate', () => this.emitState())
    this.view.webContents.on('did-navigate-in-page', () => this.emitState())
    this.view.webContents.on('did-finish-load', () => this.emitState())
    this.view.webContents.on('page-title-updated', () => this.emitState())
    this.mainWindow.contentView.addChildView(this.view)
    this.applyBounds()
    return this.view
  }

  private applyBounds(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return
    const visible =
      this.bounds.visible && this.bounds.width > 0 && this.bounds.height > 0 && !this.mainWindow.isDestroyed()
    const nextBounds: Rectangle = visible
      ? {
          x: Math.max(0, Math.round(this.bounds.x)),
          y: Math.max(0, Math.round(this.bounds.y)),
          width: Math.max(1, Math.round(this.bounds.width)),
          height: Math.max(1, Math.round(this.bounds.height))
        }
      : {
          x: 0,
          y: 0,
          width: 0,
          height: 0
        }
    this.view.setBounds(nextBounds)
  }

  private applyInitialZoomIfNeeded(): void {
    if (this.initialZoomApplied || this.userAdjustedZoom) return
    if (!this.bounds.visible || this.bounds.width <= 0) return
    this.initialZoomApplied = true
    this.setZoomFactor(resolveInitialZoomFactor(this.bounds.width), false)
  }

  private getCurrentZoomFactor(): number {
    const webContents = this.view?.webContents
    if (!webContents || webContents.isDestroyed()) return 1
    return webContents.getZoomFactor()
  }

  private setZoomFactor(value: number, userAdjusted: boolean): void {
    const view = this.ensureView()
    if (userAdjusted) {
      this.userAdjustedZoom = true
    }
    view.webContents.setZoomFactor(clampZoomFactor(value))
    this.emitState()
  }

  private emitState(): void {
    if (this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('browser-panel-state-change', this.getState())
  }

  private async runDom(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    const view = this.ensureView()
    await waitForWebContentsLoad(view.webContents)
    const stagehandModule = await import('@browserbasehq/stagehand')
    const cdpUrl = await this.getCdpWebSocketUrl()
    const runtimeModel = resolveStagehandRuntimeModel(input.llmConfig)
    const stagehand = new stagehandModule.Stagehand({
      env: 'LOCAL',
      disablePino: true,
      verbose: 0,
      disableAPI: true,
      ...(runtimeModel.mode === 'stagehand-model'
        ? { model: runtimeModel.model }
        : { llmClient: runtimeModel.llmClient }),
      localBrowserLaunchOptions: {
        cdpUrl,
        connectTimeoutMs: 20_000
      },
      actTimeoutMs: EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS,
      domSettleTimeout: 1_000
    })
    try {
      await stagehand.init()
      const page = await this.resolveStagehandPage(stagehand, view.webContents.getURL())
      const title = await page.title()
      if (input.action === 'extract') {
        const result = await stagehand.extract(input.instruction, { page })
        return {
          action: 'extract',
          page: toBrowserUsePage(page.url(), title),
          result: {
            extracted: stringifyStagehandExtraction(result)
          }
        }
      }
      if (input.action === 'observe') {
        const actions = await stagehand.observe(input.instruction, { page })
        return {
          action: 'observe',
          page: toBrowserUsePage(page.url(), title),
          result: {
            actions: actions.map(toBrowserActionCandidate)
          }
        }
      }

      const visualizer = new BrowserActionVisualizer()
      await visualizer.prepare(page)
      const visualListener = (event: unknown): void => {
        visualizer.handleFlowEvent(page, event)
      }
      stagehand.bus.on('*', visualListener)
      let result: Awaited<ReturnType<StagehandInstance['act']>>
      try {
        result = await stagehand.act(input.instruction, { page })
      } finally {
        stagehand.bus.off('*', visualListener)
        await visualizer.flush()
        await visualizer.hide(page)
      }
      return {
        action: 'act',
        page: toBrowserUsePage(page.url(), await page.title()),
        result: {
          success: result.success,
          message: result.message,
          actionDescription: result.actionDescription,
          actions: result.actions.map(toBrowserActionCandidate)
        }
      }
    } finally {
      await this.closeStagehand(stagehand)
    }
  }

  private async resolveStagehandPage(stagehand: StagehandInstance, currentUrl: string) {
    const pages = stagehand.context.pages()
    const exact = pages.find((page) => page.url() === currentUrl)
    const matched = exact || pages.find((page) => page.url() && page.url() !== 'about:blank')
    if (!matched) {
      const activePage = stagehand.context.activePage()
      if (!activePage) throw new Error('embedded browser page not found in CDP context')
      return activePage
    }
    stagehand.context.setActivePage(matched)
    return matched
  }

  private async closeStagehand(stagehand: StagehandInstance): Promise<void> {
    try {
      await stagehand.close({ force: true })
    } catch {
      return
    }
  }

  private async getCdpWebSocketUrl(): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${String(EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT)}/json/version`)
    if (!response.ok) throw new Error(`CDP endpoint unavailable: ${String(response.status)}`)
    const payload = z
      .object({
        webSocketDebuggerUrl: z.string().min(1)
      })
      .parse(await response.json())
    return payload.webSocketDebuggerUrl
  }

}

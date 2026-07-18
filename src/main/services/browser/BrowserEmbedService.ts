import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Menu, shell, webContents, WebContentsView } from 'electron'
import type {
  BrowserWindow,
  MenuItemConstructorOptions,
  NavigationEntry,
  Rectangle,
  WebContents
} from 'electron'
import { z } from 'zod/v4'
import type { BrowserActionCandidate, BrowserUsePage, BrowserUseService } from '../ai/types'
import {
  EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS,
  EMBEDDED_BROWSER_PARTITION,
  EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT,
  EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS
} from './constants'
import type { BrowserPanelBoundsState, BrowserUseRunInput, BrowserUseRunResult } from './types'
import type { BrowserTabState } from '../../../shared/types'
import { resolveStagehandRuntimeModel } from '../llm/stagehandModel'
import { BrowserActionVisualizer } from './BrowserActionVisualizer'

type StagehandModule = typeof import('@browserbasehq/stagehand')
type StagehandInstance = InstanceType<StagehandModule['Stagehand']>

type PersistedBrowserTab = {
  id: string
  ownerId: string
  title?: string
  url: string
  zoomFactor: number
  history?: {
    entries: NavigationEntry[]
    index: number
  }
  createdAt: number
  updatedAt: number
}

type BrowserTabRuntime = {
  persisted: PersistedBrowserTab
  view: WebContentsView | null
  ready: Promise<void> | null
  attached: boolean
  visible: boolean
  lastVisibleBounds: Rectangle | null
}

type PersistedBrowserWorkspace = {
  version: 2
  tabs: PersistedBrowserTab[]
}

const EMPTY_BOUNDS: BrowserPanelBoundsState = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
}

const normalizeUrl = (rawUrl: string): string => {
  const value = String(rawUrl || '').trim()
  if (!value) throw new Error('请输入网址')
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
  const parsed = new URL(withProtocol)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('内置浏览器只支持 http/https 地址')
  }
  return parsed.toString()
}

const waitForWebContentsLoad = async (contents: WebContents): Promise<void> => {
  if (!contents.isLoadingMainFrame()) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('浏览器页面加载超时')),
      EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS
    )
    const cleanup = (): void => {
      clearTimeout(timeout)
      contents.removeListener('did-finish-load', onDone)
      contents.removeListener('did-stop-loading', onDone)
      contents.removeListener('did-fail-load', onFail)
    }
    const finish = (error?: Error): void => {
      cleanup()
      error ? reject(error) : resolve()
    }
    const onDone = (): void => finish()
    const onFail = (_event: Electron.Event, _code: number, description: string): void =>
      finish(new Error(description || '浏览器页面加载失败'))
    contents.once('did-finish-load', onDone)
    contents.once('did-stop-loading', onDone)
    contents.once('did-fail-load', onFail)
  })
}

const loadWebContentsUrl = async (contents: WebContents, url: string): Promise<void> => {
  await contents.loadURL(url)
  await waitForWebContentsLoad(contents)
}

const stringifyStagehandExtraction = (value: object): string =>
  'extraction' in value && typeof value.extraction === 'string'
    ? value.extraction
    : JSON.stringify(value)

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

export class BrowserEmbedService implements BrowserUseService {
  private readonly tabs = new Map<string, BrowserTabRuntime>()
  private activeTabId: string | null = null
  private presentedTabId: string | null = null
  private presentationId = 0
  private bounds: BrowserPanelBoundsState = EMPTY_BOUNDS
  private occluded = false
  private popupMenuInstance: Menu | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  public constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly persistencePath: string
  ) {}

  public async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.persistencePath, 'utf8')
      const parsed = JSON.parse(raw) as { version?: number; tabs?: PersistedBrowserTab[] }
      if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.tabs)) return
      for (const tab of parsed.tabs) {
        if (!tab?.id || !tab.ownerId) continue
        this.tabs.set(tab.id, {
          persisted: {
            ...tab,
            zoomFactor: parsed.version === 1 ? 1 : clampZoomFactor(tab.zoomFactor || 1)
          },
          view: null,
          ready: null,
          attached: false,
          visible: false,
          lastVisibleBounds: null
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[BROWSER] Failed to restore browser tabs:', error)
      }
    }
  }

  public listTabs(ownerId: string): BrowserTabState[] {
    return [...this.tabs.values()]
      .filter((tab) => tab.persisted.ownerId === ownerId)
      .sort((left, right) => left.persisted.createdAt - right.persisted.createdAt)
      .map((tab) => this.toState(tab))
  }

  public async createTab(ownerId: string): Promise<BrowserTabState> {
    const now = Date.now()
    const persisted: PersistedBrowserTab = {
      id: randomUUID(),
      ownerId: String(ownerId || '').trim() || '__browser__',
      url: '',
      zoomFactor: 1,
      createdAt: now,
      updatedAt: now
    }
    const runtime: BrowserTabRuntime = {
      persisted,
      view: null,
      ready: null,
      attached: false,
      visible: false,
      lastVisibleBounds: null
    }
    this.tabs.set(persisted.id, runtime)
    this.activeTabId = persisted.id
    this.applyAllVisibility()
    this.schedulePersist()
    return this.toState(runtime)
  }

  public async ensureAutomationTab(ownerId: string): Promise<BrowserTabState> {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null
    if (active?.persisted.ownerId === ownerId) return this.toState(active)
    const existing = [...this.tabs.values()]
      .filter((tab) => tab.persisted.ownerId === ownerId)
      .sort((left, right) => right.persisted.updatedAt - left.persisted.updatedAt)[0]
    if (existing) {
      this.activateTab(existing.persisted.id)
      return this.toState(existing)
    }
    return await this.createTab(ownerId)
  }

  public activateTab(tabId: string): BrowserTabState {
    const runtime = this.requireTab(tabId)
    this.activeTabId = tabId
    runtime.persisted.updatedAt = Date.now()
    this.applyAllVisibility()
    if (!runtime.view) void this.ensureReady(runtime)
    this.emitState(runtime)
    this.schedulePersist()
    return this.toState(runtime)
  }

  public async closeTab(tabId: string): Promise<void> {
    const runtime = this.tabs.get(tabId)
    if (!runtime) return
    if (runtime.view && !runtime.view.webContents.isDestroyed()) {
      if (runtime.attached) this.mainWindow.contentView.removeChildView(runtime.view)
      runtime.view.webContents.close()
    }
    this.tabs.delete(tabId)
    if (this.activeTabId === tabId) this.activeTabId = null
    if (this.presentedTabId === tabId) {
      this.presentedTabId = null
      this.occluded = false
    }
    this.applyAllVisibility()
    await this.persistNow()
  }

  public show(tabId: string): number {
    const runtime = this.requireTab(tabId)
    this.activeTabId = tabId
    this.presentedTabId = tabId
    this.presentationId += 1
    this.occluded = false
    runtime.persisted.updatedAt = Date.now()
    this.applyAllVisibility()
    if (!runtime.view || runtime.view.webContents.isDestroyed()) {
      runtime.view = null
      runtime.ready = null
      runtime.attached = false
      runtime.visible = false
      runtime.lastVisibleBounds = null
      void this.ensureReady(runtime)
    }
    this.emitState(runtime)
    this.schedulePersist()
    return this.presentationId
  }

  public hide(presentationId?: number): void {
    if (presentationId !== undefined && presentationId !== this.presentationId) return
    this.closePopupMenu()
    this.presentedTabId = null
    this.occluded = false
    this.applyAllVisibility()
  }

  public setOccluded(tabId: string, presentationId: number, occluded: boolean): void {
    if (!this.isCurrentPresentation(tabId, presentationId)) return
    this.occluded = occluded
    this.applyAllVisibility()
  }

  public setBounds(tabId: string, presentationId: number, bounds: BrowserPanelBoundsState): void {
    if (!this.isCurrentPresentation(tabId, presentationId)) return
    this.bounds = bounds
    this.applyAllVisibility()
  }

  public async navigate(rawUrl: string, tabId?: string): Promise<void> {
    const runtime = this.requireTab(tabId || this.activeTabId)
    const url = normalizeUrl(rawUrl)
    const view = await this.ensureReady(runtime)
    await loadWebContentsUrl(view.webContents, url)
    this.captureRuntimeState(runtime)
  }

  public goBack(tabId: string): BrowserTabState {
    const runtime = this.requireTab(tabId)
    const history = runtime.view?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
    return this.toState(runtime)
  }

  public goForward(tabId: string): BrowserTabState {
    const runtime = this.requireTab(tabId)
    const history = runtime.view?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
    return this.toState(runtime)
  }

  public reload(tabId: string): void {
    const runtime = this.requireTab(tabId)
    if (runtime.view) {
      runtime.view.webContents.reload()
    } else {
      void this.ensureReady(runtime)
    }
  }

  public stop(tabId: string): void {
    this.requireTab(tabId).view?.webContents.stop()
  }

  public openExternal(tabId: string): void {
    const url = this.requireTab(tabId).view?.webContents.getURL()
    if (url) void shell.openExternal(url)
  }

  public async popupMenu(tabId: string, x: number, y: number): Promise<void> {
    this.closePopupMenu()
    const runtime = this.requireTab(tabId)
    const zoomPercent = this.toState(runtime).zoomPercent
    const template: MenuItemConstructorOptions[] = [
      { label: `页面缩放 (${zoomPercent}%)`, enabled: false },
      {
        label: '缩小',
        enabled: zoomPercent > Math.round(MIN_ZOOM_FACTOR * 100),
        click: () => this.zoomOut(tabId)
      },
      {
        label: '恢复为 100%',
        enabled: zoomPercent !== 100,
        click: () => this.zoomReset(tabId)
      },
      {
        label: '放大',
        enabled: zoomPercent < Math.round(MAX_ZOOM_FACTOR * 100),
        click: () => this.zoomIn(tabId)
      },
      { type: 'separator' },
      {
        label: '在系统浏览器中打开',
        enabled: Boolean(runtime.view?.webContents.getURL() || runtime.persisted.url),
        click: () => this.openExternal(tabId)
      }
    ]
    const menu = Menu.buildFromTemplate(template)
    this.popupMenuInstance = menu
    await new Promise<void>((resolve) => {
      if (this.mainWindow.isDestroyed()) {
        if (this.popupMenuInstance === menu) this.popupMenuInstance = null
        resolve()
        return
      }
      menu.popup({
        window: this.mainWindow,
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
        callback: () => {
          if (this.popupMenuInstance === menu) this.popupMenuInstance = null
          resolve()
        }
      })
    })
  }

  public closePopupMenu(): void {
    const menu = this.popupMenuInstance
    this.popupMenuInstance = null
    menu?.closePopup(this.mainWindow.isDestroyed() ? undefined : this.mainWindow)
  }

  public getState(tabId: string): BrowserTabState {
    return this.toState(this.requireTab(tabId))
  }

  public zoomIn(tabId: string): BrowserTabState {
    return this.changeZoom(tabId, ZOOM_STEP)
  }

  public zoomOut(tabId: string): BrowserTabState {
    return this.changeZoom(tabId, -ZOOM_STEP)
  }

  public zoomReset(tabId: string): BrowserTabState {
    const runtime = this.requireTab(tabId)
    runtime.persisted.zoomFactor = 1
    runtime.view?.webContents.setZoomFactor(1)
    this.emitState(runtime)
    this.schedulePersist()
    return this.toState(runtime)
  }

  public async run(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    const runtime = this.requireTab(input.tabId || this.activeTabId)
    if (input.action === 'navigate') {
      if (!input.url) throw new Error('browser_use navigate requires url')
      await this.navigate(input.url, runtime.persisted.id)
      const view = await this.ensureReady(runtime)
      return {
        action: 'navigate',
        page: toBrowserUsePage(view.webContents.getURL(), view.webContents.getTitle()),
        result: null
      }
    }
    if (input.url) await this.navigate(input.url, runtime.persisted.id)
    return await this.runDom(input, runtime)
  }

  public async dispose(): Promise<void> {
    this.closePopupMenu()
    if (this.persistTimer) clearTimeout(this.persistTimer)
    await this.persistNow()
    for (const runtime of this.tabs.values()) {
      if (runtime.view && !runtime.view.webContents.isDestroyed()) runtime.view.webContents.close()
    }
    this.tabs.clear()
  }

  private requireTab(tabId: string | null): BrowserTabRuntime {
    if (!tabId) throw new Error('browser tab is required')
    const runtime = this.tabs.get(tabId)
    if (!runtime) throw new Error('browser tab not found')
    return runtime
  }

  private isCurrentPresentation(tabId: string, presentationId: number): boolean {
    return this.presentedTabId === tabId && this.presentationId === presentationId
  }

  private async ensureReady(runtime: BrowserTabRuntime): Promise<WebContentsView> {
    if (runtime.view && runtime.ready) {
      await runtime.ready
      return runtime.view
    }
    const view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: EMBEDDED_BROWSER_PARTITION
      }
    })
    runtime.view = view
    runtime.attached = false
    this.bindViewEvents(runtime, view)
    runtime.ready = this.restoreRuntime(runtime, view)
    this.applyAllVisibility()
    await runtime.ready
    return view
  }

  private bindViewEvents(runtime: BrowserTabRuntime, view: WebContentsView): void {
    view.webContents.setWindowOpenHandler((details) => {
      void this.createTab(runtime.persisted.ownerId).then((state) =>
        this.navigate(details.url, state.id)
      )
      return { action: 'deny' }
    })
    const update = (): void => {
      this.captureRuntimeState(runtime)
      this.emitState(runtime)
    }
    view.webContents.on('did-start-loading', update)
    view.webContents.on('did-stop-loading', update)
    view.webContents.on('did-navigate', update)
    view.webContents.on('did-navigate-in-page', update)
    view.webContents.on('did-finish-load', update)
    view.webContents.on('page-title-updated', update)
  }

  private async restoreRuntime(runtime: BrowserTabRuntime, view: WebContentsView): Promise<void> {
    view.webContents.setZoomFactor(clampZoomFactor(runtime.persisted.zoomFactor || 1))
    const history = runtime.persisted.history
    if (history?.entries.length) {
      await view.webContents.navigationHistory.restore({
        entries: history.entries,
        index: history.index
      })
      return
    }
    if (runtime.persisted.url) await loadWebContentsUrl(view.webContents, runtime.persisted.url)
  }

  private applyAllVisibility(): void {
    if (this.mainWindow.isDestroyed()) return
    for (const [tabId, runtime] of this.tabs) {
      if (!runtime.view || runtime.view.webContents.isDestroyed()) continue
      const visible =
        tabId === this.presentedTabId &&
        !this.occluded &&
        this.bounds.width > 0 &&
        this.bounds.height > 0 &&
        !this.mainWindow.isDestroyed()
      if (visible) {
        const nextBounds: Rectangle = {
          x: Math.max(0, Math.round(this.bounds.x)),
          y: Math.max(0, Math.round(this.bounds.y)),
          width: Math.max(1, Math.round(this.bounds.width)),
          height: Math.max(1, Math.round(this.bounds.height))
        }
        if (!runtime.attached) {
          this.mainWindow.contentView.addChildView(runtime.view)
          runtime.attached = true
        }
        runtime.lastVisibleBounds = nextBounds
        runtime.view.setBounds(nextBounds)
        runtime.view.setVisible(true)
        if (!runtime.visible) {
          runtime.view.webContents.invalidate()
        }
      } else {
        if (!runtime.attached) {
          this.mainWindow.contentView.addChildView(runtime.view)
          runtime.attached = true
        }
        runtime.view.setBounds(this.getParkedBounds(runtime))
        runtime.view.setVisible(true)
      }
      runtime.visible = visible
    }
  }

  private getParkedBounds(runtime: BrowserTabRuntime): Rectangle {
    const parkedSize = runtime.lastVisibleBounds || {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(this.bounds.width)),
      height: Math.max(1, Math.round(this.bounds.height))
    }
    const [contentWidth] = this.mainWindow.getContentSize()
    return {
      x: contentWidth + 64,
      y: 0,
      width: parkedSize.width,
      height: parkedSize.height
    }
  }

  private changeZoom(tabId: string, delta: number): BrowserTabState {
    const runtime = this.requireTab(tabId)
    const current = runtime.view?.webContents.getZoomFactor() || runtime.persisted.zoomFactor || 1
    runtime.persisted.zoomFactor = clampZoomFactor(current + delta)
    runtime.view?.webContents.setZoomFactor(runtime.persisted.zoomFactor)
    this.emitState(runtime)
    this.schedulePersist()
    return this.toState(runtime)
  }

  private captureRuntimeState(runtime: BrowserTabRuntime): void {
    const contents = runtime.view?.webContents
    if (!contents || contents.isDestroyed()) return
    runtime.persisted.url = contents.getURL()
    runtime.persisted.title = contents.getTitle().trim() || undefined
    runtime.persisted.zoomFactor = contents.getZoomFactor()
    runtime.persisted.updatedAt = Date.now()
    const entries = contents.navigationHistory.getAllEntries()
    if (entries.length) {
      runtime.persisted.history = {
        entries,
        index: contents.navigationHistory.getActiveIndex()
      }
    }
    this.schedulePersist()
  }

  private toState(runtime: BrowserTabRuntime): BrowserTabState {
    const contents = runtime.view?.webContents
    const history = contents?.navigationHistory
    return {
      id: runtime.persisted.id,
      ownerId: runtime.persisted.ownerId,
      url: contents?.getURL() || runtime.persisted.url,
      ...(contents?.getTitle().trim() || runtime.persisted.title
        ? { title: contents?.getTitle().trim() || runtime.persisted.title }
        : {}),
      zoomPercent: Math.round(
        (contents?.getZoomFactor() || runtime.persisted.zoomFactor || 1) * 100
      ),
      canGoBack: history?.canGoBack() || false,
      canGoForward: history?.canGoForward() || false,
      isLoading: contents?.isLoadingMainFrame() || false
    }
  }

  private emitState(runtime: BrowserTabRuntime): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('browser-panel-state-change', this.toState(runtime))
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => void this.persistNow(), 250)
  }

  private async persistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    for (const runtime of this.tabs.values()) this.captureRuntimeStateWithoutScheduling(runtime)
    const payload: PersistedBrowserWorkspace = {
      version: 2,
      tabs: [...this.tabs.values()].map((runtime) => runtime.persisted)
    }
    await fs.mkdir(path.dirname(this.persistencePath), { recursive: true })
    await fs.writeFile(this.persistencePath, JSON.stringify(payload), 'utf8')
  }

  private captureRuntimeStateWithoutScheduling(runtime: BrowserTabRuntime): void {
    const contents = runtime.view?.webContents
    if (!contents || contents.isDestroyed()) return
    runtime.persisted.url = contents.getURL()
    runtime.persisted.title = contents.getTitle().trim() || undefined
    runtime.persisted.zoomFactor = contents.getZoomFactor()
    runtime.persisted.updatedAt = Date.now()
    const entries = contents.navigationHistory.getAllEntries()
    if (entries.length) {
      runtime.persisted.history = { entries, index: contents.navigationHistory.getActiveIndex() }
    }
  }

  private async resolveDevToolsTargetId(contents: WebContents): Promise<string> {
    const response = await fetch(
      `http://127.0.0.1:${String(EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT)}/json/list`
    )
    if (!response.ok) throw new Error(`CDP target list unavailable: ${String(response.status)}`)
    const targets = z
      .array(z.object({ id: z.string().min(1) }).passthrough())
      .parse(await response.json())
    const match = targets.find(
      (target) => webContents.fromDevToolsTargetId(target.id)?.id === contents.id
    )
    if (!match) throw new Error('embedded browser CDP target not found')
    return match.id
  }

  private async runDom(
    input: BrowserUseRunInput,
    runtime: BrowserTabRuntime
  ): Promise<BrowserUseRunResult> {
    const view = await this.ensureReady(runtime)
    await waitForWebContentsLoad(view.webContents)
    const stagehandModule = await import('@browserbasehq/stagehand')
    const cdpUrl = await this.getCdpWebSocketUrl()
    const targetId = await this.resolveDevToolsTargetId(view.webContents)
    const runtimeModel = resolveStagehandRuntimeModel(input.llmConfig)
    const stagehand = new stagehandModule.Stagehand({
      env: 'LOCAL',
      disablePino: true,
      verbose: 0,
      disableAPI: true,
      ...(runtimeModel.mode === 'stagehand-model'
        ? { model: runtimeModel.model }
        : { llmClient: runtimeModel.llmClient }),
      localBrowserLaunchOptions: { cdpUrl, connectTimeoutMs: 20_000 },
      actTimeoutMs: EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS,
      domSettleTimeout: 1_000
    })
    try {
      await stagehand.init()
      const page = stagehand.context.pages().find((candidate) => candidate.targetId() === targetId)
      if (!page) throw new Error('Stagehand target page not found')
      stagehand.context.setActivePage(page)
      const title = await page.title()
      if (input.action === 'extract') {
        const result = await stagehand.extract(input.instruction, { page })
        return {
          action: 'extract',
          page: toBrowserUsePage(page.url(), title),
          result: { extracted: stringifyStagehandExtraction(result) }
        }
      }
      if (input.action === 'observe') {
        const actions = await stagehand.observe(input.instruction, { page })
        return {
          action: 'observe',
          page: toBrowserUsePage(page.url(), title),
          result: { actions: actions.map(toBrowserActionCandidate) }
        }
      }
      const visualizer = new BrowserActionVisualizer()
      await visualizer.prepare(page)
      const listener = (event: unknown): void => visualizer.handleFlowEvent(page, event)
      stagehand.bus.on('*', listener)
      let result: Awaited<ReturnType<StagehandInstance['act']>>
      try {
        result = await stagehand.act(input.instruction, { page })
      } finally {
        stagehand.bus.off('*', listener)
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
      this.captureRuntimeState(runtime)
    }
  }

  private async closeStagehand(stagehand: StagehandInstance): Promise<void> {
    try {
      await stagehand.close({ force: true })
    } catch {
      return
    }
  }

  private async getCdpWebSocketUrl(): Promise<string> {
    const response = await fetch(
      `http://127.0.0.1:${String(EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT)}/json/version`
    )
    if (!response.ok) throw new Error(`CDP endpoint unavailable: ${String(response.status)}`)
    const payload = z
      .object({ webSocketDebuggerUrl: z.string().min(1) })
      .parse(await response.json())
    return payload.webSocketDebuggerUrl
  }
}

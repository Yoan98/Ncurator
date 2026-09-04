import { randomUUID } from 'node:crypto'
import { shell, webContents, WebContentsView } from 'electron'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
import { z } from 'zod/v4'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  BrowserActionCandidate,
  BrowserStagehandAction,
  BrowserUsePage,
  BrowserUseService
} from '../ai/types'
import {
  EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS,
  EMBEDDED_BROWSER_PARTITION,
  EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS
} from './constants'
import type { CdpEndpointService } from './CdpEndpointService'
import type { BrowserPanelBoundsState, BrowserUseRunInput, BrowserUseRunResult } from './types'
import type { BrowserTabState } from '../../../shared/types'
import { resolveStagehandRuntimeModel } from '../llm/stagehandModel'
import { BrowserActionVisualizer } from './BrowserActionVisualizer'
import { BrowserMenuWindowService } from './BrowserMenuWindowService'
import type {
  BrowserTabStateStore,
  PersistedBrowserTabState
} from '../storage/domains/BrowserTabStateStore'

type StagehandModule = typeof import('@browserbasehq/stagehand')
type StagehandInstance = InstanceType<StagehandModule['Stagehand']>

type BrowserTabRecord = PersistedBrowserTabState

type BrowserTabRuntime = {
  persisted: BrowserTabRecord
  view: WebContentsView | null
  ready: Promise<void> | null
  attached: boolean
  visible: boolean
  restoring: boolean
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

/** User/UI navigation: start load immediately without waiting for did-finish-load. */
const startWebContentsUrl = (contents: WebContents, url: string): void => {
  void contents.loadURL(url).catch(() => undefined)
}

const stringifyStagehandExtraction = (value: object): string =>
  'extraction' in value && typeof value.extraction === 'string'
    ? value.extraction
    : JSON.stringify(value)

const toBrowserStagehandAction = (action: {
  description: string
  method?: string
  arguments?: string[]
  selector?: string
}): BrowserStagehandAction => ({
  description: action.description,
  method: action.method || 'click',
  arguments: Array.isArray(action.arguments) ? action.arguments.map(String) : [],
  selector: action.selector || ''
})

const toBrowserActionCandidate = (
  actionId: string,
  action: BrowserStagehandAction
): BrowserActionCandidate => ({
  actionId,
  description: action.description,
  method: action.method,
  arguments: action.arguments,
  selector: action.selector
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
  private readonly hydratedOwnerIds = new Set<string>()
  private activeTabId: string | null = null
  private presentedTabId: string | null = null
  private presentationId = 0
  private bounds: BrowserPanelBoundsState = EMPTY_BOUNDS
  // 垂直 inset（顶/底到内容边缘的固定距离）来自 renderer 的权威 bounds；
  // 水平锚点（splitLeft/rightMargin/ratio）来自 renderer 的布局注册。
  // 两者齐备后，窗口 resize 时主进程可同进程实时重算 bounds。
  private verticalInset: { top: number; bottom: number } | null = null
  private followLayout: {
    splitLeft: number
    rightMargin: number
    ratio: number
    minWidth: number
    middleMin: number
    maxRatio: number
  } | null = null
  private readonly menuWindowService: BrowserMenuWindowService
  public constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly cdpEndpointService: CdpEndpointService,
    private readonly stateStore: BrowserTabStateStore
  ) {
    this.menuWindowService = new BrowserMenuWindowService(mainWindow)
    this.mainWindow.on('resize', this.handleWindowResize)
    this.mainWindow.once('closed', () => {
      this.mainWindow.removeListener('resize', this.handleWindowResize)
    })
  }

  private readonly handleWindowResize = (): void => {
    if (!this.presentedTabId || !this.followLayout || !this.verticalInset) return
    if (this.mainWindow.isDestroyed()) return
    const content = this.mainWindow.getContentBounds()
    const next = this.computeFollowBounds(content.width, content.height)
    if (!next) return
    this.bounds = next
    this.applyAllVisibility()
  }

  private computeFollowBounds(
    contentWidth: number,
    contentHeight: number
  ): BrowserPanelBoundsState | null {
    const fl = this.followLayout
    const vi = this.verticalInset
    if (!fl || !vi || contentWidth <= 0 || contentHeight <= 0) return null
    const splitWidth = Math.max(1, contentWidth - fl.splitLeft - fl.rightMargin)
    const maxByMiddle = Math.max(0, splitWidth - fl.middleMin)
    const maxByRatio = splitWidth * fl.maxRatio
    const maxWidth = Math.max(0, Math.min(maxByMiddle, maxByRatio))
    if (maxWidth <= 0) return null
    const minWidth = Math.min(fl.minWidth, maxWidth)
    const width = Math.round(Math.max(minWidth, Math.min(maxWidth, splitWidth * fl.ratio)))
    const x = Math.round(contentWidth - fl.rightMargin - width)
    const height = Math.round(contentHeight - vi.top - vi.bottom)
    if (width <= 0 || height <= 0) return null
    return { x, y: Math.round(vi.top), width, height }
  }

  public setFollowLayout(layout: {
    splitLeft: number
    rightMargin: number
    ratio: number
    minWidth: number
    middleMin: number
    maxRatio: number
  }): void {
    if (!Number.isFinite(layout.ratio) || layout.ratio <= 0) return
    this.followLayout = layout
  }

  public listTabs(ownerId: string): BrowserTabState[] {
    this.hydrateOwner(ownerId)
    return [...this.tabs.values()]
      .filter((tab) => tab.persisted.ownerId === ownerId)
      .sort((left, right) => left.persisted.createdAt - right.persisted.createdAt)
      .map((tab) => this.toState(tab))
  }

  public async createTab(ownerId: string): Promise<BrowserTabState> {
    const normalizedOwnerId = String(ownerId || '').trim() || '__browser__'
    this.hydrateOwner(normalizedOwnerId)
    const now = Date.now()
    const persisted: BrowserTabRecord = {
      id: randomUUID(),
      ownerId: normalizedOwnerId,
      url: '',
      zoomFactor: 1,
      position: this.listTabs(normalizedOwnerId).length,
      createdAt: now,
      updatedAt: now
    }
    const runtime: BrowserTabRuntime = {
      persisted,
      view: null,
      ready: null,
      attached: false,
      visible: false,
      restoring: false
    }
    this.tabs.set(persisted.id, runtime)
    this.stateStore.save(persisted)
    this.activeTabId = persisted.id
    this.applyAllVisibility()
    return this.toState(runtime)
  }

  public async ensureAutomationTab(ownerId: string): Promise<BrowserTabState> {
    this.hydrateOwner(ownerId)
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
    this.stateStore.save(runtime.persisted)
    this.applyAllVisibility()
    if (!runtime.view) void this.ensureReady(runtime)
    this.emitState(runtime)
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
    this.stateStore.delete(tabId)
    if (this.activeTabId === tabId) this.activeTabId = null
    if (this.presentedTabId === tabId) {
      this.presentedTabId = null
    }
    this.applyAllVisibility()
  }

  public async closeOwnerTabs(ownerId: string): Promise<void> {
    this.hydrateOwner(ownerId)
    const tabIds = [...this.tabs.values()]
      .filter((runtime) => runtime.persisted.ownerId === ownerId)
      .map((runtime) => runtime.persisted.id)
    for (const tabId of tabIds) await this.closeTab(tabId)
    this.stateStore.deleteByOwner(ownerId)
    this.hydratedOwnerIds.delete(ownerId)
  }

  public reassignOwner(fromOwnerId: string, toOwnerId: string): void {
    const from = String(fromOwnerId || '').trim()
    const to = String(toOwnerId || '').trim()
    if (!from || !to || from === to) return
    this.hydrateOwner(from)
    for (const runtime of this.tabs.values()) {
      if (runtime.persisted.ownerId !== from) continue
      runtime.persisted.ownerId = to
      runtime.persisted.updatedAt = Date.now()
      this.stateStore.save(runtime.persisted)
    }
    this.stateStore.promoteOwner(from, to)
    this.hydratedOwnerIds.delete(from)
    this.hydratedOwnerIds.add(to)
  }

  public show(tabId: string): number {
    const runtime = this.requireTab(tabId)
    this.activeTabId = tabId
    this.presentedTabId = tabId
    this.presentationId += 1
    runtime.persisted.updatedAt = Date.now()
    this.stateStore.save(runtime.persisted)
    this.applyAllVisibility()
    if (!runtime.view || runtime.view.webContents.isDestroyed()) {
      runtime.view = null
      runtime.ready = null
      runtime.attached = false
      runtime.visible = false
      void this.ensureReady(runtime).then(() => {
        if (this.presentedTabId === tabId) this.applyAllVisibility()
      })
    } else {
      // 后台加载完成后再挂载时，强制重绘，避免地址栏有 URL 但视口白屏。
      this.forcePresentedPaint(runtime)
    }
    this.emitState(runtime)
    return this.presentationId
  }

  public hide(presentationId?: number): void {
    if (presentationId !== undefined && presentationId !== this.presentationId) return
    this.closePopupMenu()
    this.presentedTabId = null
    this.applyAllVisibility()
  }

  public setBounds(tabId: string, presentationId: number, bounds: BrowserPanelBoundsState): void {
    if (!this.isCurrentPresentation(tabId, presentationId)) return
    // renderer 的 bounds 是权威值：顺带刷新垂直 inset，供窗口 resize 时主进程实时跟随。
    if (!this.mainWindow.isDestroyed()) {
      const contentHeight = this.mainWindow.getContentBounds().height
      if (contentHeight > 0 && bounds.height > 0) {
        this.verticalInset = {
          top: bounds.y,
          bottom: Math.max(0, contentHeight - (bounds.y + bounds.height))
        }
      }
    }
    const prev = this.bounds
    const unchanged =
      Math.round(prev.x) === Math.round(bounds.x) &&
      Math.round(prev.y) === Math.round(bounds.y) &&
      Math.round(prev.width) === Math.round(bounds.width) &&
      Math.round(prev.height) === Math.round(bounds.height)
    this.bounds = bounds
    const runtime = this.tabs.get(tabId)
    // bounds 相同也必须继续 apply：show 时 view 可能尚未创建，或 hide 后未重新挂载。
    if (unchanged && runtime?.attached && runtime.visible) return
    this.applyAllVisibility()
  }

  public async navigate(rawUrl: string, tabId?: string): Promise<void> {
    const runtime = this.requireTab(tabId || this.activeTabId)
    const url = normalizeUrl(rawUrl)
    const view = await this.ensureReady(runtime)
    runtime.persisted.url = url
    runtime.persisted.updatedAt = Date.now()
    this.stateStore.save(runtime.persisted)
    // Emit target URL before load finishes so the panel address bar updates immediately.
    this.emitState(runtime)
    startWebContentsUrl(view.webContents, url)
    this.captureRuntimeState(runtime)
  }

  public async goBack(tabId: string): Promise<BrowserTabState> {
    const runtime = this.requireTab(tabId)
    const view = await this.ensureReady(runtime)
    const history = view.webContents.navigationHistory
    if (history.canGoBack()) {
      history.goBack()
    } else {
      await this.navigatePersistedHistory(runtime, -1)
    }
    return this.toState(runtime)
  }

  public async goForward(tabId: string): Promise<BrowserTabState> {
    const runtime = this.requireTab(tabId)
    const view = await this.ensureReady(runtime)
    const history = view.webContents.navigationHistory
    if (history.canGoForward()) {
      history.goForward()
    } else {
      await this.navigatePersistedHistory(runtime, 1)
    }
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
    const runtime = this.requireTab(tabId)
    const url = runtime.view?.webContents.getURL() || runtime.persisted.url
    if (url) void shell.openExternal(url)
  }

  public async popupMenu(tabId: string, x: number, y: number): Promise<void> {
    const runtime = this.requireTab(tabId)
    await this.menuWindowService.open({
      x,
      y,
      state: this.toState(runtime),
      actions: {
        zoomIn: () => this.zoomIn(tabId),
        zoomOut: () => this.zoomOut(tabId),
        zoomReset: () => this.zoomReset(tabId)
      }
    })
  }

  public closePopupMenu(): void {
    this.menuWindowService.close()
  }

  public async popupResourceMenu(x: number, y: number): Promise<void> {
    await this.menuWindowService.openResourceMenu({
      x,
      y,
      onSelect: (kind) => {
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('browser-resource-menu-action', kind)
        }
      }
    })
  }

  public async capture(tabId: string): Promise<string | null> {
    const runtime = this.requireTab(tabId)
    const view = await this.ensureReady(runtime)
    if (view.webContents.isDestroyed()) return null
    const image = await view.webContents.capturePage()
    return image.isEmpty() ? null : image.toDataURL()
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
    return this.toState(runtime)
  }

  public getActiveTabId(): string | null {
    return this.activeTabId
  }

  public async run(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    if (input.action === 'list_tabs') {
      const tabs = this.listTabs(input.ownerId)
      return {
        action: 'list_tabs',
        tabs: tabs.map((tab) => ({
          tabId: tab.id,
          title: tab.title || tab.url || 'Untitled',
          url: tab.url || '',
          active: tab.id === this.activeTabId
        })),
        result: null
      }
    }

    if (input.action === 'navigate') {
      const tabId = input.tabId
        ? this.requireTab(input.tabId).persisted.id
        : (await this.createTab(input.ownerId)).id
      await this.navigate(input.url, tabId)
      const runtime = this.requireTab(tabId)
      const view = await this.ensureReady(runtime)
      return {
        action: 'navigate',
        tabId,
        page: toBrowserUsePage(view.webContents.getURL(), view.webContents.getTitle()),
        result: null
      }
    }

    const runtime = this.requireTab(input.tabId)
    return await this.runDom(input, runtime)
  }

  public async dispose(): Promise<void> {
    this.menuWindowService.dispose()
    for (const runtime of this.tabs.values()) {
      this.captureRuntimeState(runtime)
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

  private hydrateOwner(ownerId: string): void {
    const normalizedOwnerId = String(ownerId || '').trim()
    if (!normalizedOwnerId || this.hydratedOwnerIds.has(normalizedOwnerId)) return
    const records = this.stateStore.listByOwner(normalizedOwnerId)
    for (const persisted of records) {
      if (this.tabs.has(persisted.id)) continue
      this.tabs.set(persisted.id, {
        persisted,
        view: null,
        ready: null,
        attached: false,
        visible: false,
        restoring: false
      })
    }
    this.hydratedOwnerIds.add(normalizedOwnerId)
  }

  private isCurrentPresentation(tabId: string, presentationId: number): boolean {
    return this.presentedTabId === tabId && this.presentationId === presentationId
  }

  private async ensureReady(runtime: BrowserTabRuntime): Promise<WebContentsView> {
    if (runtime.ready) {
      await runtime.ready
      if (runtime.view && !runtime.view.webContents.isDestroyed()) return runtime.view
      runtime.view = null
      runtime.ready = null
      runtime.attached = false
      runtime.visible = false
    }

    let resolveReady: (() => void) | undefined
    runtime.ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

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
    this.applyAllVisibility()
    try {
      await this.restoreRuntime(runtime, view)
    } finally {
      resolveReady?.()
      if (this.presentedTabId === runtime.persisted.id) this.applyAllVisibility()
    }
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
      runtime.restoring = true
      try {
        await view.webContents.navigationHistory.restore({
          entries: history.entries,
          index: history.index
        })
      } finally {
        runtime.restoring = false
      }
      this.captureRuntimeState(runtime)
      this.emitState(runtime)
      return
    }
    if (runtime.persisted.url) await loadWebContentsUrl(view.webContents, runtime.persisted.url)
  }

  private forcePresentedPaint(runtime: BrowserTabRuntime): void {
    if (!runtime.view || runtime.view.webContents.isDestroyed()) return
    if (runtime.persisted.id !== this.presentedTabId) return
    if (this.bounds.width <= 0 || this.bounds.height <= 0) return
    runtime.view.setVisible(true)
    runtime.view.webContents.invalidate()
  }

  private applyAllVisibility(): void {
    if (this.mainWindow.isDestroyed()) return
    for (const [tabId, runtime] of this.tabs) {
      if (!runtime.view || runtime.view.webContents.isDestroyed()) continue
      const visible =
        tabId === this.presentedTabId &&
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
        const becomingVisible = !runtime.visible || !runtime.attached
        if (!runtime.attached) {
          this.mainWindow.contentView.addChildView(runtime.view)
          runtime.attached = true
        }
        runtime.view.setBounds(nextBounds)
        runtime.view.setVisible(true)
        if (becomingVisible) {
          runtime.view.webContents.invalidate()
        }
      } else {
        if (runtime.attached) {
          this.mainWindow.contentView.removeChildView(runtime.view)
          runtime.attached = false
        }
        runtime.view.setVisible(false)
      }
      runtime.visible = visible
    }
  }

  private changeZoom(tabId: string, delta: number): BrowserTabState {
    const runtime = this.requireTab(tabId)
    const current = runtime.view?.webContents.getZoomFactor() || runtime.persisted.zoomFactor || 1
    runtime.persisted.zoomFactor = clampZoomFactor(current + delta)
    runtime.view?.webContents.setZoomFactor(runtime.persisted.zoomFactor)
    runtime.persisted.updatedAt = Date.now()
    this.stateStore.save(runtime.persisted)
    this.emitState(runtime)
    return this.toState(runtime)
  }

  private captureRuntimeState(runtime: BrowserTabRuntime): void {
    if (runtime.restoring) return
    const contents = runtime.view?.webContents
    if (!contents || contents.isDestroyed()) return
    const nextUrl = contents.getURL()
    // Keep the optimistic navigate target until webContents reports a real URL.
    if (nextUrl) runtime.persisted.url = nextUrl
    runtime.persisted.title = contents.getTitle().trim() || undefined
    runtime.persisted.zoomFactor = contents.getZoomFactor()
    runtime.persisted.updatedAt = Date.now()
    const entries = contents.navigationHistory.getAllEntries()
    if (entries.length) {
      const index = contents.navigationHistory.getActiveIndex()
      const persistedHistory = runtime.persisted.history
      const persistedActiveUrl = persistedHistory?.entries[persistedHistory.index]?.url
      if (!persistedHistory || entries.length >= persistedHistory.entries.length) {
        runtime.persisted.history = { entries, index }
      } else if (runtime.persisted.url !== persistedActiveUrl) {
        const activeEntry = entries[index]
        if (activeEntry) {
          const retainedEntries = persistedHistory.entries.slice(0, persistedHistory.index + 1)
          runtime.persisted.history = {
            entries: [...retainedEntries, activeEntry],
            index: retainedEntries.length
          }
        }
      }
    }
    this.stateStore.save(runtime.persisted)
  }

  private toState(runtime: BrowserTabRuntime): BrowserTabState {
    const contents = runtime.view?.webContents
    const history = contents?.navigationHistory
    const persistedHistory = runtime.persisted.history
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
      canGoBack: history?.canGoBack() || Boolean(persistedHistory && persistedHistory.index > 0),
      canGoForward:
        history?.canGoForward() ||
        Boolean(persistedHistory && persistedHistory.index < persistedHistory.entries.length - 1),
      isLoading: contents?.isLoadingMainFrame() || false
    }
  }

  private emitState(runtime: BrowserTabRuntime): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('browser-panel-state-change', this.toState(runtime))
    }
  }

  private async navigatePersistedHistory(
    runtime: BrowserTabRuntime,
    offset: -1 | 1
  ): Promise<void> {
    const history = runtime.persisted.history
    if (!history) return
    const targetIndex = history.index + offset
    const target = history.entries[targetIndex]
    if (!target || !runtime.view) return
    runtime.restoring = true
    try {
      await loadWebContentsUrl(runtime.view.webContents, target.url)
    } finally {
      runtime.restoring = false
    }
    runtime.persisted.history = { ...history, index: targetIndex }
    runtime.persisted.url = target.url
    runtime.persisted.title = target.title || runtime.persisted.title
    runtime.persisted.updatedAt = Date.now()
    this.stateStore.save(runtime.persisted)
    this.emitState(runtime)
  }

  private async resolveDevToolsTargetId(contents: WebContents): Promise<string> {
    const endpoint = await this.cdpEndpointService.getEndpoint()
    const response = await fetch(`${endpoint.httpOrigin}/json/list`)
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
    input: Extract<
      BrowserUseRunInput,
      { action: 'extract' | 'observe' | 'act' | 'screenshot' }
    >,
    runtime: BrowserTabRuntime
  ): Promise<BrowserUseRunResult> {
    const view = await this.ensureReady(runtime)
    await waitForWebContentsLoad(view.webContents)
    const tabId = runtime.persisted.id
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
      const pageInfo = toBrowserUsePage(page.url(), title)

      if (input.action === 'extract') {
        const result = await stagehand.extract(input.instruction, { page })
        return {
          action: 'extract',
          tabId,
          page: pageInfo,
          result: { extracted: stringifyStagehandExtraction(result) }
        }
      }

      if (input.action === 'observe') {
        const actions = await stagehand.observe(input.instruction, { page })
        return {
          action: 'observe',
          tabId,
          page: pageInfo,
          result: { actions: actions.map(toBrowserStagehandAction) }
        }
      }

      if (input.action === 'screenshot') {
        await fs.mkdir(path.dirname(input.screenshotPath), { recursive: true })
        await page.screenshot({ fullPage: true, path: input.screenshotPath, type: 'png' })
        return {
          action: 'screenshot',
          tabId,
          page: pageInfo,
          result: { path: input.screenshotPath }
        }
      }

      if (input.action !== 'act') {
        throw new Error(`unsupported browser run action: ${String(input.action)}`)
      }

      const visualizer = new BrowserActionVisualizer()
      await visualizer.prepare(page)
      const listener = (event: unknown): void => visualizer.handleFlowEvent(page, event)
      stagehand.bus.on('*', listener)
      let result: Awaited<ReturnType<StagehandInstance['act']>>
      try {
        result = await stagehand.act(
          {
            selector: input.stagehandAction.selector,
            description: input.stagehandAction.description,
            method: input.stagehandAction.method,
            arguments: input.stagehandAction.arguments
          },
          { page }
        )
      } finally {
        stagehand.bus.off('*', listener)
        await visualizer.flush()
        await visualizer.hide(page)
      }
      const executed = toBrowserActionCandidate(input.actionId, input.stagehandAction)
      return {
        action: 'act',
        tabId,
        page: toBrowserUsePage(page.url(), await page.title()),
        result: {
          success: result.success,
          message: result.message,
          actionDescription: result.actionDescription || input.stagehandAction.description,
          executed
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
    return (await this.cdpEndpointService.getEndpoint()).browserWebSocketUrl
  }
}

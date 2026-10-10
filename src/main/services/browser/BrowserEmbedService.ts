import { randomUUID } from 'node:crypto'
import { shell, WebContentsView } from 'electron'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
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
  EMBEDDED_BROWSER_PAGE_CONTENT_POLL_MS,
  EMBEDDED_BROWSER_PAGE_CONTENT_WAIT_MS,
  EMBEDDED_BROWSER_PARTITION,
  EMBEDDED_BROWSER_RELEASE_SCRIPT_TIMEOUT_MS,
  EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS
} from './constants'
import { BROWSER_RELOAD_CONSOLE_TOKEN, buildNetErrorDocumentHtml } from './netErrorPage'
import {
  BLANK_PAGE_ERROR,
  formatNavigateNetError,
  formatEmbeddedNetErrorLabel,
  isBlankDocument,
  isAbortedNetError,
  isInternalBrowserErrorUrl,
  isNetErrorDocument,
  parseNavigatePlan,
  parseNetErrorCode,
  shouldPaintEmbeddedNetError,
  type NavigatePlan
} from './navigatePlan'
import type { CdpDebuggableContents, CdpEndpointService } from './CdpEndpointService'
import type { BrowserPanelBoundsState, BrowserUseRunInput, BrowserUseRunResult } from './types'
import type { BrowserTabState } from '../../../shared/types'
import { resolveStagehandRuntimeModel } from '../llm/stagehandModel'
import { BrowserActionVisualizer, createHideCursorScript } from './BrowserActionVisualizer'
import { BrowserMenuWindowService } from './BrowserMenuWindowService'
import type { AppErrorLogService } from '../logging/AppErrorLogService'
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
  navGeneration: number
  lastNavigateRaw: string
  pendingNavigateUrl: string
  showingNetError: boolean
}

type DocumentInspection = {
  status: 'ready' | 'blank' | 'net-error'
  url: string
  title: string
}

const EMPTY_BOUNDS: BrowserPanelBoundsState = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const createCancelledError = (): Error & { code: 'CANCELLED' } => {
  const error = new Error('cancelled') as Error & { code: 'CANCELLED' }
  error.code = 'CANCELLED'
  return error
}

const isCancelledError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'CANCELLED'
  )

const raceAbort = async <T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void | Promise<void>
): Promise<T> => {
  if (!signal) return promise
  if (signal.aborted) {
    void Promise.resolve(onAbort?.()).catch(() => undefined)
    throw createCancelledError()
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbortEvent = (): void => {
      signal.removeEventListener('abort', onAbortEvent)
      void Promise.resolve(onAbort?.()).catch(() => undefined)
      reject(createCancelledError())
    }
    signal.addEventListener('abort', onAbortEvent, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbortEvent)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbortEvent)
        reject(error)
      }
    )
  })
}

const waitForWebContentsLoad = async (
  contents: WebContents,
  signal?: AbortSignal
): Promise<void> => {
  if (!contents.isLoadingMainFrame()) return
  await raceAbort(
    new Promise<void>((resolve, reject) => {
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
    }),
    signal,
    () => {
      if (!contents.isDestroyed()) contents.stop()
    }
  )
}

const loadWebContentsUrl = async (
  contents: WebContents,
  url: string,
  signal?: AbortSignal
): Promise<void> => {
  await loadWebContentsNavigation(contents, () => contents.loadURL(url), signal)
}

const loadWebContentsNavigation = async (
  contents: WebContents,
  startLoad: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) throw createCancelledError()
  const stop = (): void => {
    if (!contents.isDestroyed()) contents.stop()
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await raceAbort(
      Promise.race([
        (async () => {
          await startLoad()
          await waitForWebContentsLoad(contents, signal)
        })(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('浏览器页面加载超时'))
            stop()
          }, EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS)
        })
      ]),
      signal,
      stop
    )
  } finally {
    clearTimeout(timeout)
  }
}

const loadUrlOnce = async (
  contents: WebContents,
  url: string,
  signal?: AbortSignal
): Promise<string | null> => {
  const failedCode = await raceAbort(
    new Promise<string | null>((resolve) => {
      let settled = false
      const cleanup = (): void => {
        contents.removeListener('did-fail-load', onFail)
        contents.removeListener('did-finish-load', onDone)
      }
      const finish = (code: string | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(code)
      }
      const onFail = (
        _event: Electron.Event,
        code: number,
        description: string,
        _failedUrl: string,
        isMainFrame: boolean
      ): void => {
        if (!isMainFrame) return
        if (isAbortedNetError(code, description)) return
        finish(formatEmbeddedNetErrorLabel(description, code))
      }
      const onDone = (): void => {
        if (isInternalBrowserErrorUrl(contents.getURL())) {
          finish(formatEmbeddedNetErrorLabel(contents.getTitle()) || 'ERR_FAILED')
          return
        }
        finish(null)
      }
      contents.on('did-fail-load', onFail)
      contents.once('did-finish-load', onDone)
      void contents.loadURL(url).catch(() => undefined)
    }),
    signal,
    () => {
      if (!contents.isDestroyed()) contents.stop()
    }
  )
  return failedCode
}

const paintNetErrorDocument = async (
  contents: WebContents,
  code: string,
  attemptedUrl: string,
  isCurrent: () => boolean = () => true
): Promise<void> => {
  if (contents.isDestroyed() || !isCurrent()) return
  if (contents.isLoadingMainFrame()) contents.stop()
  const html = buildNetErrorDocumentHtml(code, attemptedUrl)
  if (contents.isDestroyed() || !isCurrent()) return
  await contents
    .executeJavaScript(`document.open();document.write(${JSON.stringify(html)});document.close();`)
    .catch(() => undefined)
  if (!contents.isDestroyed() && isCurrent() && contents.isLoadingMainFrame()) {
    contents.stop()
  }
}

const inspectDocument = async (contents: WebContents): Promise<DocumentInspection> => {
  const url = contents.getURL()
  const title = contents.getTitle().trim()
  if (isInternalBrowserErrorUrl(url)) {
    return { status: 'net-error', url, title }
  }
  try {
    const info = (await contents.executeJavaScript(`({
      title: document.title,
      bodyText: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim(),
      controlCount: document.querySelectorAll('input,textarea,button,select').length
    })`)) as { title?: string; bodyText?: string; controlCount?: number }
    const inspectedTitle = String(info.title || title || '').trim()
    const bodyText = String(info.bodyText || '')
    if (isNetErrorDocument({ url, title: inspectedTitle, bodyText })) {
      return { status: 'net-error', url, title: inspectedTitle }
    }
    if (
      isBlankDocument({
        url,
        title: inspectedTitle,
        bodyText,
        controlCount: Number(info.controlCount || 0)
      })
    ) {
      return { status: 'blank', url, title: inspectedTitle }
    }
    return { status: 'ready', url, title: inspectedTitle }
  } catch {
    return { status: 'blank', url, title }
  }
}

const waitForUsableDocument = async (
  contents: WebContents,
  signal?: AbortSignal
): Promise<DocumentInspection> => {
  const deadline = Date.now() + EMBEDDED_BROWSER_PAGE_CONTENT_WAIT_MS
  const inspect = async (): Promise<DocumentInspection> => {
    // Electron can defer script execution forever when a navigation stopped before DOM creation.
    const blank: DocumentInspection = {
      status: 'blank',
      url: contents.getURL(),
      title: contents.getTitle().trim()
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await raceAbort(
        Promise.race([
          inspectDocument(contents),
          new Promise<DocumentInspection>((resolve) => {
            timeout = setTimeout(() => resolve(blank), Math.max(0, deadline - Date.now()))
          })
        ]),
        signal
      )
    } finally {
      clearTimeout(timeout)
    }
  }
  let last = await inspect()
  if (last.status !== 'blank') return last
  while (Date.now() < deadline) {
    await raceAbort(sleep(EMBEDDED_BROWSER_PAGE_CONTENT_POLL_MS), signal)
    if (contents.isDestroyed()) return last
    last = await inspect()
    if (last.status !== 'blank') return last
  }
  return last
}

const loadNavigatePlan = async (
  contents: WebContents,
  plan: NavigatePlan,
  signal?: AbortSignal
): Promise<
  { ok: true; url: string; title: string } | { ok: false; error: string; displayUrl: string }
> => {
  const url = plan.url
  const failedCode = await loadUrlOnce(contents, url, signal)
  if (failedCode) {
    await paintNetErrorDocument(contents, failedCode, url)
    return {
      ok: false,
      error: formatNavigateNetError({ code: failedCode, url }),
      displayUrl: url
    }
  }
  const document = await waitForUsableDocument(contents, signal)
  if (document.status === 'net-error') {
    const lastCode = parseNetErrorCode(document.title) || 'ERR_FAILED'
    await paintNetErrorDocument(contents, lastCode, url)
    return {
      ok: false,
      error: formatNavigateNetError({ code: lastCode, url }),
      displayUrl: url
    }
  }
  if (document.status === 'blank') {
    return { ok: false, error: BLANK_PAGE_ERROR, displayUrl: url }
  }
  return {
    ok: true,
    url: document.url,
    title: document.title
  }
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
  private readonly runTabMap = new Map<string, Set<string>>()
  private readonly hydratedOwnerIds = new Set<string>()
  private readonly childTabScopes = new Map<string, string>()
  private readonly tabOperations = new Map<string, Promise<unknown>>()
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
    private readonly stateStore: BrowserTabStateStore,
    private readonly errorLogService?: AppErrorLogService
  ) {
    this.menuWindowService = new BrowserMenuWindowService(mainWindow, errorLogService)
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

  public async createTab(ownerId: string, background = false): Promise<BrowserTabState> {
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
      restoring: false,
      navGeneration: 0,
      lastNavigateRaw: '',
      pendingNavigateUrl: '',
      showingNetError: false
    }
    this.tabs.set(persisted.id, runtime)
    this.stateStore.save(persisted)
    if (!background) this.activeTabId = persisted.id
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
    if (!runtime.view) this.prepareView(runtime)
    this.emitState(runtime)
    return this.toState(runtime)
  }

  public async closeTab(tabId: string): Promise<void> {
    const runtime = this.tabs.get(tabId)
    if (!runtime) return
    if (runtime.view && !runtime.view.webContents.isDestroyed()) {
      this.cdpEndpointService.unregisterContents(runtime.view.webContents)
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
      this.prepareView(runtime)
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
    const plan = parseNavigatePlan(rawUrl)
    const view = await this.ensureReady(runtime)
    const primaryUrl = plan.url
    runtime.navGeneration += 1
    runtime.lastNavigateRaw = rawUrl
    runtime.pendingNavigateUrl = primaryUrl
    runtime.showingNetError = false
    runtime.persisted.url = primaryUrl
    runtime.persisted.updatedAt = Date.now()
    this.stateStore.save(runtime.persisted)
    this.emitState(runtime)
    startWebContentsUrl(view.webContents, primaryUrl)
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
    if (runtime.showingNetError || runtime.lastNavigateRaw) {
      const raw = runtime.lastNavigateRaw || runtime.persisted.url
      if (runtime.showingNetError && raw) {
        void this.navigate(raw, tabId)
        return
      }
    }
    if (runtime.view) {
      runtime.view.webContents.reload()
    } else {
      this.prepareView(runtime)
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
    if ('tabId' in input && input.tabId) {
      const scope = this.childTabScopes.get(input.tabId)
      if (scope !== input.executionScope)
        throw new Error('browser tab is outside this execution scope')
      const previous = this.tabOperations.get(input.tabId) || Promise.resolve()
      const operation = previous
        .catch(() => undefined)
        .then(() => {
          if (input.abortSignal?.aborted) throw createCancelledError()
          return this.runScoped(input)
        })
      this.tabOperations.set(input.tabId, operation)
      try {
        return await operation
      } finally {
        if (this.tabOperations.get(input.tabId) === operation)
          this.tabOperations.delete(input.tabId)
      }
    }
    return await this.runScoped(input)
  }

  private async runScoped(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    if (input.action === 'list_tabs') {
      const tabs = this.listTabs(input.ownerId).filter(
        (tab) => this.childTabScopes.get(tab.id) === input.executionScope
      )
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
      const plan = parseNavigatePlan(input.url)
      const tabId = input.tabId
        ? this.requireTab(input.tabId).persisted.id
        : (await this.createTab(input.ownerId, input.background)).id
      if (input.abortSignal?.aborted) throw createCancelledError()
      if (input.runId) {
        this.trackRunTab(input.runId, tabId)
      }
      if (input.executionScope) this.childTabScopes.set(tabId, input.executionScope)
      const runtime = this.requireTab(tabId)
      runtime.lastNavigateRaw = input.url
      runtime.navGeneration += 1
      runtime.showingNetError = false
      const view = await this.ensureReady(runtime, input.abortSignal)
      if (input.abortSignal?.aborted) throw createCancelledError()
      const primaryUrl = plan.url
      runtime.pendingNavigateUrl = primaryUrl
      runtime.persisted.url = primaryUrl
      runtime.persisted.updatedAt = Date.now()
      this.stateStore.save(runtime.persisted)
      this.emitState(runtime)
      try {
        const outcome = await loadNavigatePlan(view.webContents, plan, input.abortSignal)
        this.captureRuntimeState(runtime)
        if (!outcome.ok) {
          runtime.showingNetError = true
          this.emitState(runtime)
          return {
            action: 'navigate',
            tabId,
            page: toBrowserUsePage(outcome.displayUrl),
            error: outcome.error
          }
        }
        return {
          action: 'navigate',
          tabId,
          page: toBrowserUsePage(outcome.url, outcome.title),
          result: null
        }
      } catch (error) {
        if (isCancelledError(error) || input.abortSignal?.aborted) throw createCancelledError()
        this.captureRuntimeState(runtime)
        return {
          action: 'navigate',
          tabId,
          page: toBrowserUsePage(primaryUrl),
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }

    if (input.runId && input.tabId) {
      this.trackRunTab(input.runId, input.tabId)
    }

    const runtime = this.requireTab(input.tabId)
    return await this.runDom(input, runtime)
  }

  public async releaseRun(runId: string): Promise<void> {
    const normalizedRunId = String(runId || '').trim()
    if (!normalizedRunId) return
    const tabIds = this.runTabMap.get(normalizedRunId)
    this.runTabMap.delete(normalizedRunId)
    for (const [tabId, scope] of this.childTabScopes)
      if (scope === normalizedRunId) this.childTabScopes.delete(tabId)
    this.applyAllVisibility()
    if (!tabIds || tabIds.size === 0) return

    const hideScript = createHideCursorScript()
    await Promise.allSettled(
      [...tabIds].map(async (tabId) => {
        const runtime = this.tabs.get(tabId)
        if (!runtime?.view || runtime.view.webContents.isDestroyed()) return
        const contents = runtime.view.webContents
        if (!contents.getURL() || contents.getURL().startsWith('about:blank')) return
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            contents.executeJavaScript(hideScript).catch(() => undefined),
            new Promise<void>((resolve) => {
              timeout = setTimeout(resolve, EMBEDDED_BROWSER_RELEASE_SCRIPT_TIMEOUT_MS)
            })
          ])
        } finally {
          clearTimeout(timeout)
        }
      })
    )
  }

  private trackRunTab(runId: string, tabId: string): void {
    const normalizedRunId = String(runId || '').trim()
    const normalizedTabId = String(tabId || '').trim()
    if (!normalizedRunId || !normalizedTabId) return
    let tabIds = this.runTabMap.get(normalizedRunId)
    if (!tabIds) {
      tabIds = new Set()
      this.runTabMap.set(normalizedRunId, tabIds)
    }
    tabIds.add(normalizedTabId)
    this.applyAllVisibility()
  }

  public async dispose(): Promise<void> {
    this.menuWindowService.dispose()
    for (const runtime of this.tabs.values()) {
      this.captureRuntimeState(runtime)
      if (runtime.view && !runtime.view.webContents.isDestroyed()) {
        this.cdpEndpointService.unregisterContents(runtime.view.webContents)
        runtime.view.webContents.close()
      }
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
        restoring: false,
        navGeneration: 0,
        lastNavigateRaw: persisted.url || '',
        pendingNavigateUrl: '',
        showingNetError: false
      })
    }
    this.hydratedOwnerIds.add(normalizedOwnerId)
  }

  private isCurrentPresentation(tabId: string, presentationId: number): boolean {
    return this.presentedTabId === tabId && this.presentationId === presentationId
  }

  private prepareView(runtime: BrowserTabRuntime): void {
    void this.ensureReady(runtime).catch((error) => {
      console.warn('[BROWSER] Failed to restore tab:', error)
    })
  }

  private async ensureReady(
    runtime: BrowserTabRuntime,
    signal?: AbortSignal
  ): Promise<WebContentsView> {
    if (signal?.aborted) throw createCancelledError()
    while (runtime.ready) {
      const ready = runtime.ready
      await raceAbort(ready, signal, () => {
        if (runtime.view && !runtime.view.webContents.isDestroyed()) runtime.view.webContents.stop()
      })
      if (runtime.ready !== ready) continue
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
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
    runtime.view = view
    runtime.attached = false
    this.bindViewEvents(runtime, view)
    this.applyAllVisibility()
    try {
      await this.restoreRuntime(runtime, view, signal)
    } catch (error) {
      if (runtime.view === view) {
        this.cdpEndpointService.unregisterContents(view.webContents)
        if (runtime.attached && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(view)
        }
        runtime.view = null
        runtime.ready = null
        runtime.attached = false
        runtime.visible = false
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
      if (!isCancelledError(error)) {
        this.errorLogService?.write({
          module: 'embedded-browser',
          error: 'Browser tab restore failed',
          context: { event: 'tab-restore-failed', tabId: runtime.persisted.id }
        })
      }
      throw error
    } finally {
      resolveReady?.()
      if (this.presentedTabId === runtime.persisted.id) this.applyAllVisibility()
    }
    return view
  }

  private bindViewEvents(runtime: BrowserTabRuntime, view: WebContentsView): void {
    view.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || runtime.view !== view) return
      this.errorLogService?.write({
        module: 'embedded-browser',
        error: 'Browser renderer exited',
        context: {
          event: 'render-process-gone',
          tabId: runtime.persisted.id,
          reason: details.reason,
          exitCode: details.exitCode
        }
      })
    })
    view.webContents.on('unresponsive', () => {
      if (runtime.view !== view) return
      this.errorLogService?.write({
        module: 'embedded-browser',
        error: 'Browser renderer became unresponsive',
        context: { event: 'unresponsive', tabId: runtime.persisted.id }
      })
    })
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
    view.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (
        !shouldPaintEmbeddedNetError({
          isMainFrame,
          errorCode: code,
          description
        })
      ) {
        return
      }
      const generation = runtime.navGeneration
      runtime.showingNetError = true
      this.emitState(runtime)
      void paintNetErrorDocument(
        view.webContents,
        formatEmbeddedNetErrorLabel(description, code),
        runtime.persisted.url || view.webContents.getURL(),
        () => runtime.navGeneration === generation
      ).then(() => {
        if (runtime.navGeneration === generation) this.emitState(runtime)
      })
    })
    view.webContents.on('did-start-loading', update)
    view.webContents.on('did-stop-loading', update)
    view.webContents.on('did-navigate', update)
    view.webContents.on('did-navigate-in-page', update)
    view.webContents.on('did-finish-load', update)
    view.webContents.on('page-title-updated', update)
    view.webContents.on('console-message', (event, _level, message) => {
      const text =
        typeof message === 'string'
          ? message
          : typeof (event as { message?: unknown }).message === 'string'
            ? String((event as { message: string }).message)
            : ''
      if (!text.includes(BROWSER_RELOAD_CONSOLE_TOKEN)) return
      const raw = runtime.lastNavigateRaw || runtime.persisted.url
      if (raw) void this.navigate(raw, runtime.persisted.id)
    })
  }

  private async restoreRuntime(
    runtime: BrowserTabRuntime,
    view: WebContentsView,
    signal?: AbortSignal
  ): Promise<void> {
    const restoredZoom = clampZoomFactor(runtime.persisted.zoomFactor || 1)
    const restoredHistory = runtime.persisted.history
      ? {
          entries: runtime.persisted.history.entries.map((entry) => ({ ...entry })),
          index: runtime.persisted.history.index
        }
      : undefined

    runtime.restoring = true
    try {
      view.webContents.setZoomFactor(restoredZoom)
      if (restoredHistory?.entries.length) {
        await loadWebContentsNavigation(
          view.webContents,
          () =>
            view.webContents.navigationHistory.restore({
              entries: restoredHistory.entries,
              index: restoredHistory.index
            }),
          signal
        )
      } else if (runtime.persisted.url) {
        await loadWebContentsUrl(view.webContents, runtime.persisted.url, signal)
      }
      // Navigation restore often resets zoom to 1; re-apply the persisted factor after load.
      view.webContents.setZoomFactor(restoredZoom)
      runtime.persisted.zoomFactor = restoredZoom
      if (restoredHistory?.entries.length) {
        runtime.persisted.history = restoredHistory
      }
      runtime.persisted.updatedAt = Date.now()
      this.stateStore.save(runtime.persisted)
    } finally {
      runtime.restoring = false
    }
    this.emitState(runtime)
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
      const controlled = [...this.runTabMap.values()].some((tabs) => tabs.has(tabId))
      if (visible || controlled) {
        const nextBounds: Rectangle = visible
          ? {
              x: Math.max(0, Math.round(this.bounds.x)),
              y: Math.max(0, Math.round(this.bounds.y)),
              width: Math.max(1, Math.round(this.bounds.width)),
              height: Math.max(1, Math.round(this.bounds.height))
            }
          : { x: 0, y: 0, width: 1280, height: 800 }
        const becomingVisible = (visible && !runtime.visible) || !runtime.attached
        // BrowserWindow's own page is not a child of contentView. An index of zero
        // still overlays it, so background pages must be hidden, keeping their bounds.
        if (!runtime.attached || (visible && !runtime.visible)) {
          this.mainWindow.contentView.addChildView(runtime.view)
          runtime.attached = true
        }
        runtime.view.setBounds(nextBounds)
        runtime.view.setVisible(visible)
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
    // Chromium error pages use chrome-error://; the address bar should keep the attempted site.
    if (nextUrl && !isInternalBrowserErrorUrl(nextUrl)) {
      if (runtime.pendingNavigateUrl) {
        if (nextUrl === runtime.pendingNavigateUrl) {
          runtime.persisted.url = nextUrl
          runtime.pendingNavigateUrl = ''
        }
      } else {
        runtime.persisted.url = nextUrl
      }
    }
    runtime.persisted.title = contents.getTitle().trim() || undefined
    // Zoom is owned by changeZoom / restoreRuntime. Do not mirror getZoomFactor() here:
    // navigation restore briefly reports 1.0 and would wipe the persisted zoom.
    // Navigation also resets Electron's live factor — re-apply the owned value.
    const ownedZoom = clampZoomFactor(runtime.persisted.zoomFactor || 1)
    if (Math.abs(contents.getZoomFactor() - ownedZoom) > 0.001) {
      contents.setZoomFactor(ownedZoom)
    }
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
    const liveUrl = contents?.getURL() || ''
    const preferPersisted =
      runtime.showingNetError ||
      Boolean(runtime.pendingNavigateUrl) ||
      Boolean(contents?.isLoadingMainFrame())
    const url = preferPersisted
      ? runtime.persisted.url || liveUrl
      : liveUrl && !isInternalBrowserErrorUrl(liveUrl)
        ? liveUrl
        : runtime.persisted.url || liveUrl
    return {
      id: runtime.persisted.id,
      ownerId: runtime.persisted.ownerId,
      url,
      ...(contents?.getTitle().trim() || runtime.persisted.title
        ? { title: contents?.getTitle().trim() || runtime.persisted.title }
        : {}),
      // Prefer persisted zoom: live getZoomFactor() is briefly 1.0 across navigations.
      zoomPercent: Math.round(
        (runtime.persisted.zoomFactor || contents?.getZoomFactor() || 1) * 100
      ),
      canGoBack: history?.canGoBack() || Boolean(persistedHistory && persistedHistory.index > 0),
      canGoForward:
        history?.canGoForward() ||
        Boolean(persistedHistory && persistedHistory.index < persistedHistory.entries.length - 1),
      isLoading: runtime.showingNetError ? false : contents?.isLoadingMainFrame() || false
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

  private async runDom(
    input: Extract<
      BrowserUseRunInput,
      { action: 'extract' | 'observe' | 'act' | 'act_instruction' | 'screenshot' | 'scroll' }
    >,
    runtime: BrowserTabRuntime
  ): Promise<BrowserUseRunResult> {
    const signal = input.abortSignal
    const view = await this.ensureReady(runtime, signal)
    await waitForWebContentsLoad(view.webContents, signal)
    const usable = await waitForUsableDocument(view.webContents, signal)
    const tabId = runtime.persisted.id
    if (usable.status !== 'ready') {
      const displayUrl = isInternalBrowserErrorUrl(view.webContents.getURL())
        ? runtime.persisted.url || usable.url
        : usable.url
      return {
        action: input.action,
        tabId,
        page: toBrowserUsePage(displayUrl, usable.title),
        error:
          usable.status === 'blank'
            ? BLANK_PAGE_ERROR
            : `无法访问此站点（${parseNetErrorCode(usable.title) || 'ERR_FAILED'}）。当前页面无法打开。`
      }
    }
    const stagehandModule = await import('@browserbasehq/stagehand')
    const targetId = await this.cdpEndpointService.registerTarget(
      view.webContents as CdpDebuggableContents
    )
    try {
      const cdpUrl = (await this.cdpEndpointService.getScopedEndpoint(targetId)).browserWebSocketUrl
      const runtimeModel = resolveStagehandRuntimeModel(input.llmConfig)
      if (runtimeModel.mode === 'langchain-client') {
        runtimeModel.llmClient.setAbortSignal(signal)
      }
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
      const abortStagehand = (): Promise<void> => this.closeStagehand(stagehand)
      try {
        await raceAbort(stagehand.init(), signal, abortStagehand)
        const page = stagehand.context
          .pages()
          .find((candidate) => candidate.targetId() === targetId)
        if (!page) throw new Error('Stagehand target page not found')
        stagehand.context.setActivePage(page)
        const title = await raceAbort(page.title(), signal, abortStagehand)
        const pageInfo = toBrowserUsePage(page.url(), title)

        if (input.action === 'extract') {
          const result = await raceAbort(
            stagehand.extract(input.instruction, { page }),
            signal,
            abortStagehand
          )
          return {
            action: 'extract',
            tabId,
            page: pageInfo,
            result: { extracted: stringifyStagehandExtraction(result) }
          }
        }

        if (input.action === 'observe') {
          const actions = await raceAbort(
            stagehand.observe(input.instruction, { page }),
            signal,
            abortStagehand
          )
          return {
            action: 'observe',
            tabId,
            page: pageInfo,
            result: { actions: actions.map(toBrowserStagehandAction) }
          }
        }

        if (input.action === 'screenshot') {
          await fs.mkdir(path.dirname(input.screenshotPath), { recursive: true })
          await raceAbort(
            page.screenshot({
              fullPage: false,
              animations: 'disabled',
              caret: 'hide',
              scale: 'device',
              path: input.screenshotPath,
              type: 'png'
            }),
            signal,
            abortStagehand
          )
          return {
            action: 'screenshot',
            tabId,
            page: pageInfo,
            result: { path: input.screenshotPath }
          }
        }

        if (input.action === 'scroll') {
          const percentage = Math.max(1, Math.min(200, input.percentage ?? 80))
          const direction = input.direction ?? 'down'
          const { w, h } = (await raceAbort(
            page.mainFrame().evaluate('({ w: window.innerWidth, h: window.innerHeight })'),
            signal,
            abortStagehand
          )) as { w: number; h: number }
          const scrollDistance = Math.round((h * percentage) / 100)
          const cx = Math.floor(w / 2)
          const cy = Math.floor(h / 2)
          const deltaY = direction === 'up' ? -scrollDistance : scrollDistance

          await raceAbort(page.scroll(cx, cy, 0, deltaY), signal, abortStagehand)
          await raceAbort(page.waitForTimeout(300), signal, abortStagehand)

          return {
            action: 'scroll',
            tabId,
            page: toBrowserUsePage(page.url(), await page.title()),
            result: {
              message: `Scrolled ${percentage}% ${direction} (${scrollDistance}px)`,
              scrolledPixels: scrollDistance
            }
          }
        }

        if (input.action === 'act_instruction') {
          const visualizer = new BrowserActionVisualizer()
          await visualizer.prepare(page)
          const listener = (event: unknown): void => visualizer.handleFlowEvent(page, event)
          stagehand.bus.on('*', listener)
          let result: Awaited<ReturnType<StagehandInstance['act']>>
          try {
            result = await raceAbort(
              stagehand.act(input.instruction, { page }),
              signal,
              abortStagehand
            )
          } finally {
            stagehand.bus.off('*', listener)
            await visualizer.flush()
          }
          return {
            action: 'act_instruction',
            tabId,
            page: toBrowserUsePage(page.url(), await page.title()),
            result: {
              success: result.success,
              message: result.message,
              actionDescription: result.actionDescription || input.instruction
            }
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
          result = await raceAbort(
            stagehand.act(
              {
                selector: input.stagehandAction.selector,
                description: input.stagehandAction.description,
                method: input.stagehandAction.method,
                arguments: input.stagehandAction.arguments
              },
              { page }
            ),
            signal,
            abortStagehand
          )
        } finally {
          stagehand.bus.off('*', listener)
          await visualizer.flush()
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
    } finally {
      this.cdpEndpointService.unregisterTarget(targetId)
    }
  }

  private async closeStagehand(stagehand: StagehandInstance): Promise<void> {
    try {
      await stagehand.close({ force: true })
    } catch {
      return
    }
  }
}

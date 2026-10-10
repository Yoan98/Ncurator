import { describe, expect, it, vi } from 'vitest'
import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { BrowserEmbedService } from '../../../../src/main/services/browser/BrowserEmbedService'
import { BROWSER_CURSOR_OVERLAY_ID } from '../../../../src/main/services/browser/BrowserActionVisualizer'
import { AiRunResourceManager } from '../../../../src/main/services/ai/run/AiRunResourceManager'
import type {
  BrowserTabStateStore,
  PersistedBrowserTabState
} from '../../../../src/main/services/storage/domains/BrowserTabStateStore'
import type { CdpEndpointService } from '../../../../src/main/services/browser/CdpEndpointService'
import {
  EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS,
  EMBEDDED_BROWSER_PAGE_CONTENT_WAIT_MS
} from '../../../../src/main/services/browser/constants'

vi.mock('electron', () => ({
  WebContentsView: vi.fn(),
  BrowserWindow: vi.fn(),
  screen: { getDisplayMatching: vi.fn(), getCursorScreenPoint: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

const createMockStateStore = (): BrowserTabStateStore => ({
  listByOwner: vi.fn().mockReturnValue([]),
  save: vi.fn(),
  delete: vi.fn(),
  clearByOwner: vi.fn(),
  reassignOwner: vi.fn()
})

const createMockCdpEndpointService = (): CdpEndpointService =>
  ({
    getEndpoint: vi.fn().mockResolvedValue({
      browserWebSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
      port: 9222,
      httpOrigin: 'http://127.0.0.1:9222'
    }),
    registerTarget: vi.fn().mockReturnValue('target-mock'),
    unregisterTarget: vi.fn(),
    unregisterContents: vi.fn(),
    dispose: vi.fn()
  }) as unknown as CdpEndpointService

const createMockMainWindow = (): BrowserWindow =>
  ({
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn()
    },
    getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1000, height: 800 })
  }) as unknown as BrowserWindow

const getBrowserInternals = (service: BrowserEmbedService) =>
  service as unknown as {
    tabs: Map<string, object>
    runTabMap: Map<string, Set<string>>
    trackRunTab: (runId: string, tabId: string) => void
    applyAllVisibility: () => void
    ensureReady: (runtime: object) => Promise<WebContentsView>
    restoreRuntime: (
      runtime: { persisted: PersistedBrowserTabState; restoring: boolean },
      view: WebContentsView,
      signal?: AbortSignal
    ) => Promise<void>
  }

const createPendingRestore = (history: boolean) => {
  const stateStore = createMockStateStore()
  const service = new BrowserEmbedService(
    createMockMainWindow(),
    createMockCdpEndpointService(),
    stateStore
  )
  const load = vi.fn(() => new Promise<void>(() => {}))
  const stop = vi.fn()
  const runtime = {
    persisted: {
      id: 'restored-tab',
      ownerId: 'partner',
      url: 'https://example.com/slow',
      zoomFactor: 1,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
      ...(history ? { history: { entries: [{ url: 'https://example.com/slow' }], index: 0 } } : {})
    },
    restoring: false
  }
  const view = {
    webContents: {
      isDestroyed: () => false,
      setZoomFactor: vi.fn(),
      navigationHistory: { restore: load },
      loadURL: load,
      stop
    }
  } as unknown as WebContentsView
  const controller = new AbortController()
  return {
    runtime,
    controller,
    load,
    stop,
    stateStore,
    restore: () => getBrowserInternals(service).restoreRuntime(runtime, view, controller.signal)
  }
}

const createPendingDocument = () => {
  const cdp = createMockCdpEndpointService()
  const service = new BrowserEmbedService(createMockMainWindow(), cdp, createMockStateStore())
  const executeJavaScript = vi.fn(() => new Promise<void>(() => {}))
  getBrowserInternals(service).tabs.set('unfinished-document', {
    persisted: { id: 'unfinished-document' },
    ready: Promise.resolve(),
    view: {
      webContents: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        getURL: () => 'https://example.com/slow',
        getTitle: () => '',
        executeJavaScript
      }
    }
  })
  const controller = new AbortController()
  const run = () =>
    service.run({
      action: 'extract',
      tabId: 'unfinished-document',
      instruction: '读取页面内容',
      abortSignal: controller.signal,
      llmConfig: {
        id: 'unit',
        name: 'unit',
        providerKind: 'openai-compatible',
        api_key: '',
        base_url: 'https://example.com',
        model_name: 'unit'
      }
    })
  return { run, controller, cdp, executeJavaScript }
}

describe('BrowserEmbedService - Run Lifecycle & Cursor Retention', () => {
  it('discards a failed restored view so the next attempt creates a fresh one', async () => {
    const mainWindow = createMockMainWindow()
    const cdp = createMockCdpEndpointService()
    const service = new BrowserEmbedService(mainWindow, cdp, createMockStateStore())
    const makeView = (): WebContentsView =>
      ({
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        webContents: {
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
          on: vi.fn(),
          setWindowOpenHandler: vi.fn()
        }
      }) as unknown as WebContentsView
    const failedView = makeView()
    const retryView = makeView()
    vi.mocked(WebContentsView)
      .mockImplementationOnce(function () {
        return failedView
      })
      .mockImplementationOnce(function () {
        return retryView
      })
    const internals = getBrowserInternals(service)
    let finishRetry: (() => void) | undefined
    const retryPending = new Promise<void>((resolve) => {
      finishRetry = resolve
    })
    const restore = vi
      .spyOn(internals, 'restoreRuntime')
      .mockRejectedValueOnce(new Error('restore failed'))
      .mockReturnValueOnce(retryPending)
    const runtime = {
      persisted: { id: 'restored-tab', ownerId: 'partner' },
      view: null,
      ready: null,
      attached: false,
      visible: false
    }
    internals.tabs.set('restored-tab', runtime)
    const failed = internals.ensureReady(runtime)
    const waitingA = internals.ensureReady(runtime)
    const waitingB = internals.ensureReady(runtime)
    await expect(failed).rejects.toThrow('restore failed')
    expect(failedView.webContents.close).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(restore).toHaveBeenCalledTimes(2))
    let secondWaiterFinished = false
    void waitingB.then(() => {
      secondWaiterFinished = true
    })
    await Promise.resolve()
    expect(secondWaiterFinished).toBe(false)
    finishRetry?.()
    await expect(waitingA).resolves.toBe(retryView)
    await expect(waitingB).resolves.toBe(retryView)
    expect(runtime.view).toBe(retryView)
  })

  it('hides controlled background views while keeping their usable bounds', () => {
    const window = createMockMainWindow()
    const service = new BrowserEmbedService(
      window,
      createMockCdpEndpointService(),
      createMockStateStore()
    )
    const view = {
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: { isDestroyed: () => false, invalidate: vi.fn() }
    }
    const internals = getBrowserInternals(service)
    internals.tabs.set('background-tab', { view, attached: false, visible: false })
    internals.trackRunTab('child-run', 'background-tab')
    internals.applyAllVisibility()
    expect(window.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1280, height: 800 })
  })

  it.each([false, true])('bounds stalled restored navigation (history=%s)', async (history) => {
    vi.useFakeTimers()
    try {
      const pending = createPendingRestore(history)
      const response = pending.restore()
      const failed = expect(response).rejects.toThrow('浏览器页面加载超时')
      await vi.advanceTimersByTimeAsync(EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS + 1)
      await failed
      expect(pending.load).toHaveBeenCalledOnce()
      expect(pending.stop).toHaveBeenCalledOnce()
      expect(pending.runtime.restoring).toBe(false)
      expect(pending.stateStore.save).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([false, true])('cancels stalled restored navigation (history=%s)', async (history) => {
    vi.useFakeTimers()
    try {
      const pending = createPendingRestore(history)
      const response = pending.restore()
      const cancelled = expect(response).rejects.toThrow('cancelled')
      pending.controller.abort()
      await cancelled
      expect(pending.stop).toHaveBeenCalledOnce()
      expect(pending.runtime.restoring).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds content inspection when an unfinished document never executes JavaScript', async () => {
    vi.useFakeTimers()
    try {
      const pending = createPendingDocument()
      const response = pending.run()
      await vi.advanceTimersByTimeAsync(EMBEDDED_BROWSER_PAGE_CONTENT_WAIT_MS + 1)
      expect(await response).toMatchObject({ action: 'extract', error: expect.any(String) })
      expect(pending.executeJavaScript).toHaveBeenCalledOnce()
      expect(pending.cdp.registerTarget).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an unfinished document inspection without waiting for its script or deadline', async () => {
    vi.useFakeTimers()
    try {
      const pending = createPendingDocument()
      const response = pending.run()
      const cancelled = expect(response).rejects.toThrow('cancelled')
      await vi.advanceTimersByTimeAsync(0)
      expect(pending.executeJavaScript).toHaveBeenCalledOnce()
      pending.controller.abort()
      await cancelled
      expect(pending.cdp.registerTarget).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases cursor on registered tabs when releaseRun is called', async () => {
    const stateStore = createMockStateStore()
    const cdpService = createMockCdpEndpointService()
    const mockMainWindow = createMockMainWindow()

    const service = new BrowserEmbedService(mockMainWindow, cdpService, stateStore)

    const executeJsMock = vi.fn().mockResolvedValue(undefined)
    const tabRuntime = {
      persisted: {
        id: 'tab-1',
        ownerKey: 'session-1',
        url: 'https://example.com',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      view: {
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'https://example.com',
          executeJavaScript: executeJsMock
        }
      },
      ready: Promise.resolve(),
      attached: true,
      visible: true,
      restoring: false
    }

    // Access private properties for targeted unit testing
    const tabsMap = getBrowserInternals(service).tabs
    tabsMap.set('tab-1', tabRuntime)

    // Simulate trackRunTab
    getBrowserInternals(service).trackRunTab('run-123', 'tab-1')

    // Release the run
    await service.releaseRun('run-123')

    expect(executeJsMock).toHaveBeenCalledOnce()
    const injectedScript = executeJsMock.mock.calls[0][0]
    expect(injectedScript).toContain(BROWSER_CURSOR_OVERLAY_ID)
    expect(injectedScript).toContain("opacity = '0'")

    // Releasing again should not trigger another call since runTabMap is cleared
    await service.releaseRun('run-123')
    expect(executeJsMock).toHaveBeenCalledOnce()
  })

  it('safely skips destroyed webContents during releaseRun', async () => {
    const stateStore = createMockStateStore()
    const cdpService = createMockCdpEndpointService()
    const mockMainWindow = createMockMainWindow()

    const service = new BrowserEmbedService(mockMainWindow, cdpService, stateStore)
    const executeJsMock = vi.fn().mockResolvedValue(undefined)

    const tabRuntime = {
      persisted: {
        id: 'tab-2',
        ownerKey: 'session-1',
        url: 'https://example.com',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      view: {
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        webContents: {
          isDestroyed: () => true,
          executeJavaScript: executeJsMock
        }
      },
      ready: Promise.resolve(),
      attached: true,
      visible: true,
      restoring: false
    }

    const tabsMap = getBrowserInternals(service).tabs
    tabsMap.set('tab-2', tabRuntime)
    getBrowserInternals(service).trackRunTab('run-456', 'tab-2')
    await service.releaseRun('run-456')

    expect(executeJsMock).not.toHaveBeenCalled()
  })

  it('detaches background views when cursor cleanup cannot finish', async () => {
    const mainWindow = createMockMainWindow()
    const service = new BrowserEmbedService(
      mainWindow,
      createMockCdpEndpointService(),
      createMockStateStore()
    )
    const executeJavaScript = vi.fn(() => new Promise<void>(() => {}))
    const view = {
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        getURL: () => 'https://example.com',
        executeJavaScript
      }
    }
    const internals = getBrowserInternals(service)
    internals.tabs.set('pending-page', { view, attached: true, visible: false })
    internals.trackRunTab('pending-run', 'pending-page')
    await service.releaseRun('pending-run')
    expect(internals.runTabMap.has('pending-run')).toBe(false)
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(executeJavaScript).toHaveBeenCalledOnce()
  })

  it('integrates with AiRunResourceManager for lifecycle coordination', async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined)
    const browserService = {
      releaseRun: releaseMock
    }

    const resourceManager = new AiRunResourceManager([
      { id: 'browser', releaseRun: (runId) => browserService.releaseRun(runId) }
    ])

    await resourceManager.releaseRun('test-run-id')
    expect(releaseMock).toHaveBeenCalledWith('test-run-id')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { BrowserEmbedService } from '../../../../src/main/services/browser/BrowserEmbedService'
import { BROWSER_CURSOR_OVERLAY_ID } from '../../../../src/main/services/browser/BrowserActionVisualizer'
import { AiRunResourceManager } from '../../../../src/main/services/ai/run/AiRunResourceManager'
import type { BrowserTabStateStore } from '../../../../src/main/services/storage/domains/BrowserTabStateStore'
import type { CdpEndpointService } from '../../../../src/main/services/browser/CdpEndpointService'

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
  }

describe('BrowserEmbedService - Run Lifecycle & Cursor Retention', () => {
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

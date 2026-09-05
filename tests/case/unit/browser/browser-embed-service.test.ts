import { describe, expect, it, vi } from 'vitest'
import { BrowserEmbedService } from '../../../../src/main/services/browser/BrowserEmbedService'
import { BROWSER_CURSOR_OVERLAY_ID } from '../../../../src/main/services/browser/BrowserActionVisualizer'
import { AiRunResourceManager } from '../../../../src/main/services/ai/run/AiRunResourceManager'
import type { BrowserTabStateStore, PersistedBrowserTabState } from '../../../../src/main/services/storage/domains/BrowserTabStateStore'
import type { CdpEndpointService } from '../../../../src/main/services/browser/CdpEndpointService'

const createMockStateStore = (): BrowserTabStateStore => ({
  listByOwner: vi.fn().mockReturnValue([]),
  save: vi.fn(),
  delete: vi.fn(),
  clearByOwner: vi.fn(),
  reassignOwner: vi.fn()
})

const createMockCdpEndpointService = (): CdpEndpointService => ({
  getEndpoint: vi.fn().mockResolvedValue({
    browserWebSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
    port: 9222,
    browserPath: '/devtools/browser/mock'
  }),
  dispose: vi.fn()
})

const createMockMainWindow = () =>
  ({
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn()
    },
    getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1000, height: 800 })
  }) as any

describe('BrowserEmbedService - Run Lifecycle & Cursor Retention', () => {
  it('releases cursor on registered tabs when releaseRun is called', async () => {
    const stateStore = createMockStateStore()
    const cdpService = createMockCdpEndpointService()
    const mockMainWindow = createMockMainWindow()

    const service = new BrowserEmbedService(mockMainWindow, stateStore, cdpService)

    const executeJsMock = vi.fn().mockResolvedValue(undefined)
    const tabRuntime = {
      persisted: { id: 'tab-1', ownerKey: 'session-1', url: 'https://example.com', createdAt: Date.now(), updatedAt: Date.now() },
      view: {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: executeJsMock
        }
      },
      ready: Promise.resolve(),
      attached: true,
      visible: true,
      restoring: false
    }

    // Access private properties for targeted unit testing
    const tabsMap = (service as any).tabs as Map<string, any>
    tabsMap.set('tab-1', tabRuntime)

    // Simulate trackRunTab
    ;(service as any).trackRunTab('run-123', 'tab-1')

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

    const service = new BrowserEmbedService(mockMainWindow, stateStore, cdpService)
    const executeJsMock = vi.fn().mockResolvedValue(undefined)

    const tabRuntime = {
      persisted: { id: 'tab-2', ownerKey: 'session-1', url: 'https://example.com', createdAt: Date.now(), updatedAt: Date.now() },
      view: {
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

    const tabsMap = (service as any).tabs as Map<string, any>
    tabsMap.set('tab-2', tabRuntime)

    ;(service as any).trackRunTab('run-456', 'tab-2')
    await service.releaseRun('run-456')

    expect(executeJsMock).not.toHaveBeenCalled()
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

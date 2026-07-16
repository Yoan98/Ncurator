import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const updaterListeners = new Map<string, (...args: unknown[]) => void>()
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const updater: Record<string, unknown> = {}
  const appState = {
    isPackaged: true,
    version: '0.1.0'
  }
  const windowSend = vi.fn()

  updater.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    updaterListeners.set(event, listener)
    return updater
  })
  updater.checkForUpdates = vi.fn()
  updater.downloadUpdate = vi.fn()
  updater.quitAndInstall = vi.fn()
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.logger = null

  return {
    updater,
    updaterListeners,
    ipcHandlers,
    appState,
    windowSend
  }
})

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return mocks.appState.isPackaged
    },
    getVersion: () => mocks.appState.version
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: mocks.windowSend
        }
      }
    ]
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcHandlers.set(channel, handler)
    })
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mocks.updater
}))

import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_DOWNLOAD_CHANNEL,
  APP_UPDATE_GET_SNAPSHOT_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL
} from '../../../../src/shared/constants'
import type { AppUpdateActionResponse, AppUpdateSnapshot } from '../../../../src/shared/types'
import { AppUpdateService } from '../../../../src/main/services/update/AppUpdateService'

const originalPlatform = process.platform

const getIpcHandler = (channel: string): ((...args: unknown[]) => unknown) => {
  const handler = mocks.ipcHandlers.get(channel)
  if (!handler) throw new Error(`missing IPC handler: ${channel}`)
  return handler
}

const emitUpdaterEvent = (event: string, ...args: unknown[]): void => {
  const listener = mocks.updaterListeners.get(event)
  if (!listener) throw new Error(`missing updater listener: ${event}`)
  listener(...args)
}

describe('AppUpdateService contract', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    mocks.appState.isPackaged = true
    mocks.appState.version = '0.1.0'
    mocks.updaterListeners.clear()
    mocks.ipcHandlers.clear()
    mocks.windowSend.mockReset()
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockReset()
    vi.mocked(mocks.updater.downloadUpdate as () => Promise<unknown>).mockReset()
    vi.mocked(mocks.updater.quitAndInstall as () => void).mockReset()
    ;(mocks.updater.on as ReturnType<typeof vi.fn>).mockClear()
    mocks.updater.autoDownload = false
    mocks.updater.autoInstallOnAppQuit = false
    mocks.updater.logger = null
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('checks, downloads on request and installs an available update', async () => {
    const checkForUpdates = vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>)
    checkForUpdates.mockImplementation(async () => {
      emitUpdaterEvent('checking-for-update')
      emitUpdaterEvent('update-available', {
        version: '0.1.1',
        releaseName: 'v0.1.1',
        releaseDate: '2026-07-13T08:00:00.000Z'
      })
      return null
    })
    vi.mocked(mocks.updater.downloadUpdate as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('download-progress', {
          percent: 42,
          transferred: 42,
          total: 100,
          bytesPerSecond: 8
        })
        emitUpdaterEvent('update-downloaded', {
          version: '0.1.1',
          releaseName: 'v0.1.1',
          releaseDate: '2026-07-13T08:00:00.000Z'
        })
        return null
      }
    )

    const service = new AppUpdateService()
    service.initialize()

    const checkResponse = (await getIpcHandler(
      APP_UPDATE_CHECK_CHANNEL
    )()) as AppUpdateActionResponse

    expect(mocks.updater.autoDownload).toBe(false)
    expect(mocks.updater.autoInstallOnAppQuit).toBe(true)
    expect(checkResponse).toMatchObject({
      success: true,
      snapshot: {
        status: 'available',
        currentVersion: '0.1.0',
        availableVersion: '0.1.1'
      }
    })

    const downloadResponse = (await getIpcHandler(
      APP_UPDATE_DOWNLOAD_CHANNEL
    )()) as AppUpdateActionResponse
    const snapshot = getIpcHandler(APP_UPDATE_GET_SNAPSHOT_CHANNEL)() as AppUpdateSnapshot

    expect(downloadResponse).toMatchObject({
      success: true,
      snapshot: {
        status: 'downloaded',
        availableVersion: '0.1.1',
        progressPercent: 100
      }
    })
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(snapshot.status).toBe('downloaded')
    expect(
      mocks.windowSend.mock.calls.map((call) => (call[1] as AppUpdateSnapshot).status)
    ).toEqual(['checking', 'checking', 'available', 'downloading', 'downloading', 'downloaded'])

    const installResponse = getIpcHandler(APP_UPDATE_INSTALL_CHANNEL)() as AppUpdateActionResponse
    expect(installResponse.success).toBe(true)
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('refuses downloads before an update is available', async () => {
    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_DOWNLOAD_CHANNEL)()) as AppUpdateActionResponse

    expect(response).toMatchObject({ success: false, error: '当前没有可下载的更新' })
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('keeps the available version so a failed download can be retried', async () => {
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('update-available', { version: '0.1.1' })
        return null
      }
    )
    vi.mocked(mocks.updater.downloadUpdate as () => Promise<unknown>)
      .mockRejectedValueOnce(new Error('download interrupted'))
      .mockImplementationOnce(async () => {
        emitUpdaterEvent('update-downloaded', { version: '0.1.1' })
        return null
      })

    const service = new AppUpdateService()
    service.initialize()
    await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()

    const failed = (await getIpcHandler(APP_UPDATE_DOWNLOAD_CHANNEL)()) as AppUpdateActionResponse
    expect(failed).toMatchObject({
      success: false,
      snapshot: { status: 'error', availableVersion: '0.1.1' }
    })

    const retried = (await getIpcHandler(APP_UPDATE_DOWNLOAD_CHANNEL)()) as AppUpdateActionResponse
    expect(retried).toMatchObject({ success: true, snapshot: { status: 'downloaded' } })
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  it('reports that the packaged app is already up to date', async () => {
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('update-not-available', {
          version: '0.1.0',
          releaseName: 'v0.1.0',
          releaseDate: '2026-07-13T05:42:00.000Z'
        })
        return null
      }
    )

    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: true,
      snapshot: {
        status: 'not-available',
        availableVersion: '0.1.0'
      }
    })
  })

  it('surfaces check failures and refuses installation before download finishes', async () => {
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockRejectedValue(
      new Error('network unavailable')
    )

    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: false,
      error: 'network unavailable',
      snapshot: {
        status: 'error',
        error: 'network unavailable'
      }
    })

    const installResponse = getIpcHandler(APP_UPDATE_INSTALL_CHANNEL)() as AppUpdateActionResponse
    expect(installResponse).toMatchObject({
      success: false,
      error: '更新包尚未下载完成'
    })
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('surfaces updater error events such as checksum verification failures', async () => {
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('error', new Error('sha512 checksum mismatch'))
        return null
      }
    )

    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: false,
      error: 'sha512 checksum mismatch',
      snapshot: {
        status: 'error',
        error: 'sha512 checksum mismatch'
      }
    })
  })

  it('does not start another check while an update is already available', async () => {
    let finishFirstCheck: (() => void) | undefined
    const firstCheckPending = new Promise<void>((resolve) => {
      finishFirstCheck = resolve
    })
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('update-available', {
          version: '0.1.1',
          releaseName: 'v0.1.1',
          releaseDate: '2026-07-13T08:00:00.000Z'
        })
        await firstCheckPending
        return null
      }
    )

    const service = new AppUpdateService()
    service.initialize()

    const firstResponsePromise = getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()
    const secondResponse = (await getIpcHandler(
      APP_UPDATE_CHECK_CHANNEL
    )()) as AppUpdateActionResponse

    expect(secondResponse).toMatchObject({
      success: true,
      snapshot: {
        status: 'available',
        availableVersion: '0.1.1'
      }
    })
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    finishFirstCheck?.()
    await firstResponsePromise
  })

  it('checks after startup and repeats every four hours', async () => {
    const schedule =
      vi.fn<(callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>>()
    schedule.mockImplementation((callback) => {
      callback()
      return 1 as unknown as ReturnType<typeof setTimeout>
    })
    const repeat =
      vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    repeat.mockReturnValue(2 as unknown as ReturnType<typeof setInterval>)
    vi.mocked(mocks.updater.checkForUpdates as () => Promise<unknown>).mockImplementation(
      async () => {
        emitUpdaterEvent('update-not-available', { version: '0.1.0' })
        return null
      }
    )

    const service = new AppUpdateService({ schedule, repeat })
    service.initialize()
    service.checkForUpdatesOnLaunch()

    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule.mock.calls[0]?.[1]).toBe(5000)
    expect(repeat).toHaveBeenCalledOnce()
    expect(repeat.mock.calls[0]?.[1]).toBe(4 * 60 * 60 * 1000)
    await vi.waitFor(() => {
      expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
    })
    repeat.mock.calls[0]?.[0]()
    await vi.waitFor(() => {
      expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
    })
  })

  it('initializes listeners and IPC handlers only once', () => {
    const service = new AppUpdateService()
    service.initialize()
    service.initialize()

    expect(mocks.updater.on).toHaveBeenCalledTimes(6)
    expect(mocks.ipcHandlers.size).toBe(4)
  })

  it('keeps automatic updates disabled in development mode', async () => {
    mocks.appState.isPackaged = false
    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: false,
      error: '开发模式不会检查自动更新',
      snapshot: {
        isPackaged: false,
        updateSupported: false
      }
    })
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.updater.on).not.toHaveBeenCalled()
  })

  it('keeps automatic updates disabled on unsupported packaged platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const service = new AppUpdateService()
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: false,
      error: '当前系统暂不支持自动更新',
      snapshot: {
        isPackaged: true,
        updateSupported: false,
        platform: 'linux'
      }
    })
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.updater.on).not.toHaveBeenCalled()
  })

  it('explains why an unsigned macOS build cannot auto update', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const service = new AppUpdateService({ macUpdateSignatureValid: () => false })
    service.initialize()

    const response = (await getIpcHandler(APP_UPDATE_CHECK_CHANNEL)()) as AppUpdateActionResponse
    expect(response).toMatchObject({
      success: false,
      error: 'macOS 自动更新需要固定的非 ad-hoc 代码签名',
      snapshot: {
        updateSupported: false,
        unsupportedReason: 'macOS 自动更新需要固定的非 ad-hoc 代码签名',
        platform: 'darwin'
      }
    })
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('enables automatic updates for a signed macOS build', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const service = new AppUpdateService({ macUpdateSignatureValid: () => true })
    service.initialize()

    const snapshot = getIpcHandler(APP_UPDATE_GET_SNAPSHOT_CHANNEL)() as AppUpdateSnapshot
    expect(snapshot).toMatchObject({
      updateSupported: true,
      platform: 'darwin'
    })
    expect(mocks.updater.on).toHaveBeenCalledTimes(6)
  })
})

import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_GET_SNAPSHOT_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_STATUS_CHANNEL
} from '../../../shared/constants'
import type { AppUpdateActionResponse, AppUpdateSnapshot } from '../../../shared/types'

const SUPPORTED_UPDATE_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'win32'])
const STARTUP_UPDATE_CHECK_DELAY_MS = 5000

const getUpdateErrorMessage = (error: Error | string): string =>
  error instanceof Error ? error.message : error

const normalizeOptionalText = (value: string | null | undefined): string | undefined =>
  value || undefined

export class AppUpdateService {
  private initialized = false
  private checking = false
  private snapshot: AppUpdateSnapshot = {
    status: 'idle',
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    updateSupported: app.isPackaged && SUPPORTED_UPDATE_PLATFORMS.has(process.platform),
    platform: process.platform
  }

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    this.registerIpcHandlers()

    if (!this.snapshot.updateSupported) {
      return
    }

    autoUpdater.logger = console
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.setSnapshot({ status: 'checking', error: undefined })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setSnapshot({
        status: 'available',
        availableVersion: info.version,
        releaseName: normalizeOptionalText(info.releaseName),
        releaseDate: info.releaseDate,
        error: undefined
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.setSnapshot({
        status: 'not-available',
        availableVersion: info.version,
        releaseName: normalizeOptionalText(info.releaseName),
        releaseDate: info.releaseDate,
        progressPercent: undefined,
        transferredBytes: undefined,
        totalBytes: undefined,
        bytesPerSecond: undefined,
        error: undefined
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setSnapshot({
        status: 'downloading',
        progressPercent: progress.percent,
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        error: undefined
      })
    })

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.setSnapshot({
        status: 'downloaded',
        availableVersion: event.version,
        releaseName: normalizeOptionalText(event.releaseName),
        releaseDate: event.releaseDate,
        progressPercent: 100,
        error: undefined
      })
    })

    autoUpdater.on('error', (error: Error) => {
      this.checking = false
      this.setSnapshot({
        status: 'error',
        error: getUpdateErrorMessage(error)
      })
    })
  }

  checkForUpdatesOnLaunch(): void {
    if (!this.snapshot.updateSupported) return
    setTimeout(() => {
      void this.checkForUpdates()
    }, STARTUP_UPDATE_CHECK_DELAY_MS)
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(APP_UPDATE_GET_SNAPSHOT_CHANNEL, () => this.snapshot)
    ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, () => this.checkForUpdates())
    ipcMain.handle(APP_UPDATE_INSTALL_CHANNEL, () => this.quitAndInstall())
  }

  private async checkForUpdates(): Promise<AppUpdateActionResponse> {
    if (!this.snapshot.updateSupported) {
      return {
        success: false,
        snapshot: this.snapshot,
        error: app.isPackaged ? '当前系统暂不支持自动更新' : '开发模式不会检查自动更新'
      }
    }

    if (this.checking || this.snapshot.status === 'downloading') {
      return {
        success: true,
        snapshot: this.snapshot
      }
    }

    this.checking = true
    this.setSnapshot({ status: 'checking', error: undefined })

    try {
      await autoUpdater.checkForUpdates()
      return {
        success: true,
        snapshot: this.snapshot
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.setSnapshot({ status: 'error', error: errorMessage })
      return {
        success: false,
        snapshot: this.snapshot,
        error: errorMessage
      }
    } finally {
      this.checking = false
    }
  }

  private quitAndInstall(): AppUpdateActionResponse {
    if (this.snapshot.status !== 'downloaded') {
      return {
        success: false,
        snapshot: this.snapshot,
        error: '更新包尚未下载完成'
      }
    }

    autoUpdater.quitAndInstall(false, true)
    return {
      success: true,
      snapshot: this.snapshot
    }
  }

  private setSnapshot(patch: Partial<AppUpdateSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      updateSupported: app.isPackaged && SUPPORTED_UPDATE_PLATFORMS.has(process.platform),
      platform: process.platform
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(APP_UPDATE_STATUS_CHANNEL, this.snapshot)
      }
    }
  }
}

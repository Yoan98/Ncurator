import { app, BrowserWindow, ipcMain } from 'electron'
import { spawnSync } from 'node:child_process'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_GET_SNAPSHOT_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_STATUS_CHANNEL
} from '../../../shared/constants'
import type { AppUpdateActionResponse, AppUpdateSnapshot } from '../../../shared/types'

const MAC_UPDATE_SIGNATURE_ERROR = 'macOS 自动更新需要有效的 Developer ID 签名'
const STARTUP_UPDATE_CHECK_DELAY_MS = 5000
const UPDATE_BUSY_STATUSES = new Set<AppUpdateSnapshot['status']>([
  'checking',
  'available',
  'downloading'
])

type AppUpdateDependencies = {
  app: Pick<typeof app, 'getVersion'> & { readonly isPackaged: boolean }
  updater: typeof autoUpdater
  ipc: Pick<typeof ipcMain, 'handle'>
  getWindows: typeof BrowserWindow.getAllWindows
  platform: NodeJS.Platform
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  macCodeSignatureValid: () => boolean
}

const hasValidMacCodeSignature = (): boolean => {
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', process.execPath], {
    encoding: 'utf8'
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  return (
    result.status === 0 &&
    /Authority=Developer ID Application:/u.test(output) &&
    /TeamIdentifier=(?!not set\b)\S+/u.test(output)
  )
}

const createDefaultDependencies = (): AppUpdateDependencies => ({
  app,
  updater: autoUpdater,
  ipc: ipcMain,
  getWindows: () => BrowserWindow.getAllWindows(),
  platform: process.platform,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  macCodeSignatureValid: hasValidMacCodeSignature
})

const getUpdateErrorMessage = (error: Error | string): string =>
  error instanceof Error ? error.message : error

const normalizeOptionalText = (value: string | null | undefined): string | undefined =>
  value || undefined

export class AppUpdateService {
  private initialized = false
  private checking = false
  private readonly dependencies: AppUpdateDependencies
  private readonly unsupportedReason: string | undefined
  private snapshot: AppUpdateSnapshot

  constructor(dependencies: Partial<AppUpdateDependencies> = {}) {
    this.dependencies = {
      ...createDefaultDependencies(),
      ...dependencies
    }
    this.unsupportedReason = this.resolveUnsupportedReason()
    this.snapshot = this.createSnapshot({ status: 'idle' })
  }

  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    this.registerIpcHandlers()

    if (!this.snapshot.updateSupported) {
      return
    }

    const { updater } = this.dependencies
    updater.logger = console
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true

    updater.on('checking-for-update', () => {
      this.setSnapshot({ status: 'checking', error: undefined })
    })

    updater.on('update-available', (info: UpdateInfo) => {
      this.setSnapshot({
        status: 'available',
        availableVersion: info.version,
        releaseName: normalizeOptionalText(info.releaseName),
        releaseDate: info.releaseDate,
        error: undefined
      })
    })

    updater.on('update-not-available', (info: UpdateInfo) => {
      this.checking = false
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

    updater.on('download-progress', (progress: ProgressInfo) => {
      this.setSnapshot({
        status: 'downloading',
        progressPercent: progress.percent,
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
        error: undefined
      })
    })

    updater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.checking = false
      this.setSnapshot({
        status: 'downloaded',
        availableVersion: event.version,
        releaseName: normalizeOptionalText(event.releaseName),
        releaseDate: event.releaseDate,
        progressPercent: 100,
        error: undefined
      })
    })

    updater.on('error', (error: Error) => {
      this.checking = false
      this.setSnapshot({
        status: 'error',
        error: getUpdateErrorMessage(error)
      })
    })
  }

  checkForUpdatesOnLaunch(): void {
    if (!this.snapshot.updateSupported) return
    this.dependencies.schedule(() => {
      void this.checkForUpdates()
    }, STARTUP_UPDATE_CHECK_DELAY_MS)
  }

  private registerIpcHandlers(): void {
    this.dependencies.ipc.handle(APP_UPDATE_GET_SNAPSHOT_CHANNEL, () => this.snapshot)
    this.dependencies.ipc.handle(APP_UPDATE_CHECK_CHANNEL, () => this.checkForUpdates())
    this.dependencies.ipc.handle(APP_UPDATE_INSTALL_CHANNEL, () => this.quitAndInstall())
  }

  private async checkForUpdates(): Promise<AppUpdateActionResponse> {
    if (!this.snapshot.updateSupported) {
      return {
        success: false,
        snapshot: this.snapshot,
        error: this.snapshot.unsupportedReason || '当前系统暂不支持自动更新'
      }
    }

    if (this.checking || UPDATE_BUSY_STATUSES.has(this.snapshot.status)) {
      return {
        success: true,
        snapshot: this.snapshot
      }
    }

    this.checking = true
    this.setSnapshot({ status: 'checking', error: undefined })

    try {
      await this.dependencies.updater.checkForUpdates()
      if (this.snapshot.status === 'error') {
        return {
          success: false,
          snapshot: this.snapshot,
          error: this.snapshot.error || '检查更新失败'
        }
      }
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

    this.dependencies.updater.quitAndInstall(false, true)
    return {
      success: true,
      snapshot: this.snapshot
    }
  }

  private setSnapshot(patch: Partial<AppUpdateSnapshot>): void {
    this.snapshot = this.createSnapshot({
      ...this.snapshot,
      ...patch
    })
    this.emitSnapshot()
  }

  private createSnapshot(
    snapshot: Pick<AppUpdateSnapshot, 'status'> & Partial<AppUpdateSnapshot>
  ): AppUpdateSnapshot {
    const { app: electronApp, platform } = this.dependencies
    return {
      ...snapshot,
      currentVersion: electronApp.getVersion(),
      isPackaged: electronApp.isPackaged,
      updateSupported: this.unsupportedReason === undefined,
      unsupportedReason: this.unsupportedReason,
      platform
    }
  }

  private resolveUnsupportedReason(): string | undefined {
    const { app: electronApp, platform, macCodeSignatureValid } = this.dependencies
    if (!electronApp.isPackaged) return '开发模式不会检查自动更新'
    if (platform === 'win32') return undefined
    if (platform === 'darwin') {
      return macCodeSignatureValid() ? undefined : MAC_UPDATE_SIGNATURE_ERROR
    }
    return '当前系统暂不支持自动更新'
  }

  private emitSnapshot(): void {
    for (const window of this.dependencies.getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(APP_UPDATE_STATUS_CHANNEL, this.snapshot)
      }
    }
  }
}

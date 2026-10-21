import { mainText } from './app/i18n'
import { BrowserWindow, Notification } from 'electron'
import type { AiRunRecord, AiRunStatus } from '../../shared/types'
import type { AppSettingsStore } from './storage/domains/AppSettingsStore'

export type RunTerminalStatus = Extract<AiRunStatus, 'completed' | 'failed' | 'cancelled'>

type NotificationLike = {
  show: () => void
  on: (event: 'click', listener: () => void) => unknown
}

type SystemNotificationServiceDeps = {
  settingsStore: AppSettingsStore
  getMainWindow: () => BrowserWindow | null
  createMainWindow?: () => BrowserWindow
  createNotification?: (options: Electron.NotificationConstructorOptions) => NotificationLike
  isSupported?: () => boolean
  notificationIcon?: string
}

const STATUS_KEYS = {
  completed: ['runCompleted', 'runCompletedBody'],
  failed: ['runFailed', 'runFailedBody'],
  cancelled: ['runCancelled', 'runCancelledBody']
} as const

export class SystemNotificationService {
  public constructor(private readonly deps: SystemNotificationServiceDeps) {}

  public async notifyRunTerminal(run: AiRunRecord, status: RunTerminalStatus): Promise<void> {
    const settings = await this.deps.settingsStore.get()
    if (!settings.systemNotificationsEnabled) return
    if (!(this.deps.isSupported || Notification.isSupported)()) return

    const [titleKey, bodyKey] = STATUS_KEYS[status]
    const copy = { title: mainText(titleKey), body: mainText(bodyKey) }
    const notification = (this.deps.createNotification || ((options) => new Notification(options)))(
      {
        title: copy.title,
        body: copy.body,
        ...(this.deps.notificationIcon ? { icon: this.deps.notificationIcon } : {}),
        silent: false
      }
    )

    notification.on('click', () => {
      void this.openPartner(run.partnerId)
    })
    notification.show()

    const observer = (
      globalThis as typeof globalThis & {
        __NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__?: (payload: {
          runId: string
          partnerId: string
          status: RunTerminalStatus
          title: string
          body: string
        }) => void
      }
    ).__NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__
    observer?.({ runId: run.id, partnerId: run.partnerId, status, ...copy })
  }

  private async openPartner(partnerId: string): Promise<void> {
    const window = this.deps.getMainWindow() || this.deps.createMainWindow?.()
    if (!window || window.isDestroyed()) return
    if (window.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          window.webContents.removeListener('did-finish-load', finish)
          window.webContents.removeListener('did-fail-load', finish)
          resolve()
        }
        window.webContents.once('did-finish-load', finish)
        window.webContents.once('did-fail-load', finish)
        if (!window.webContents.isLoading()) finish()
      })
    }
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('system-notification-open-session', partnerId)
    }
  }
}

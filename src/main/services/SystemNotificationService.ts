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
  waiting_human: ['runNeedsAnswer', 'runNeedsAnswerBody'],
  completed: ['runCompleted', 'runCompletedBody'],
  failed: ['runFailed', 'runFailedBody'],
  cancelled: ['runCancelled', 'runCancelledBody']
} as const

export class SystemNotificationService {
  private readonly notifiedQuestions = new Set<string>()
  public constructor(private readonly deps: SystemNotificationServiceDeps) {}

  public async notifyRunTerminal(run: AiRunRecord, status: RunTerminalStatus): Promise<void> {
    await this.notify(run, status)
    for (const key of this.notifiedQuestions) {
      if (key.startsWith(`${run.id}:`)) this.notifiedQuestions.delete(key)
    }
  }

  public async notifyRunQuestion(run: AiRunRecord, interactionId: string): Promise<void> {
    const key = `${run.id}:${interactionId}`
    if (this.notifiedQuestions.has(key)) return
    this.notifiedQuestions.add(key)
    try {
      await this.notify(run, 'waiting_human', interactionId)
    } catch (error) {
      this.notifiedQuestions.delete(key)
      throw error
    }
  }

  private async notify(
    run: AiRunRecord,
    status: RunTerminalStatus | 'waiting_human',
    interactionId?: string
  ): Promise<void> {
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
      void this.openPartner(run.partnerId, interactionId)
    })
    notification.show()

    const observer = (
      globalThis as typeof globalThis & {
        __NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__?: (payload: {
          runId: string
          partnerId: string
          status: RunTerminalStatus | 'waiting_human'
          title: string
          body: string
        }) => void
      }
    ).__NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__
    observer?.({ runId: run.id, partnerId: run.partnerId, status, ...copy })
  }

  private async openPartner(partnerId: string, interactionId?: string): Promise<void> {
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
      if (interactionId)
        window.webContents.send('system-notification-open-session', partnerId, interactionId)
      else window.webContents.send('system-notification-open-session', partnerId)
    }
  }
}

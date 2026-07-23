import { BrowserWindow, Notification } from 'electron'
import type { AiRunRecord, AiRunStatus } from '../../shared/types'
import type { AiRuntimeSettingsStore } from './storage/domains/AiRuntimeSettingsStore'

export type RunTerminalStatus = Extract<AiRunStatus, 'completed' | 'failed' | 'cancelled'>

type NotificationLike = {
  show: () => void
  on: (event: 'click', listener: () => void) => unknown
}

type SystemNotificationServiceDeps = {
  settingsStore: AiRuntimeSettingsStore
  getMainWindow: () => BrowserWindow | null
  createMainWindow?: () => BrowserWindow
  createNotification?: (options: Electron.NotificationConstructorOptions) => NotificationLike
  isSupported?: () => boolean
}

const STATUS_COPY: Record<RunTerminalStatus, { title: string; body: string }> = {
  completed: { title: 'AI 运行已完成', body: '点击查看对话结果' },
  failed: { title: 'AI 运行失败', body: '点击查看失败详情' },
  cancelled: { title: 'AI 运行已取消', body: '点击返回对话' }
}

export class SystemNotificationService {
  public constructor(private readonly deps: SystemNotificationServiceDeps) {}

  public async notifyRunTerminal(run: AiRunRecord, status: RunTerminalStatus): Promise<void> {
    const settings = await this.deps.settingsStore.get()
    if (!settings.systemNotificationsEnabled) return
    if (!(this.deps.isSupported || Notification.isSupported)()) return

    const copy = STATUS_COPY[status]
    const notification = (this.deps.createNotification || ((options) => new Notification(options)))(
      {
        title: copy.title,
        body: copy.body,
        silent: false
      }
    )

    notification.on('click', () => {
      void this.openSession(run.sessionId)
    })
    notification.show()

    const observer = (
      globalThis as typeof globalThis & {
        __NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__?: (payload: {
          runId: string
          sessionId: string
          status: RunTerminalStatus
          title: string
          body: string
        }) => void
      }
    ).__NCURATOR_E2E_RECORD_SYSTEM_NOTIFICATION__
    observer?.({ runId: run.id, sessionId: run.sessionId, status, ...copy })
  }

  private async openSession(sessionId: string): Promise<void> {
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
      window.webContents.send('system-notification-open-session', sessionId)
    }
  }
}

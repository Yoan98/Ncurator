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

    notification.on('click', () => this.openSession(run.sessionId))
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

  private openSession(sessionId: string): void {
    const window = this.deps.getMainWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (!window.webContents.isDestroyed()) {
      window.webContents.send('system-notification-open-session', sessionId)
    }
  }
}

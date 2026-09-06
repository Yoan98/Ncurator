import { describe, expect, it, vi } from 'vitest'
import { SystemNotificationService } from '../../../src/main/services/SystemNotificationService'
import type { AiRunRecord, AiRuntimeSettings } from '../../../src/shared/types'

const run = (status: AiRunRecord['status'] = 'completed'): AiRunRecord => ({
  id: 'run-1',
  partnerId: 'partner-1',
  userMessageId: 'user-1',
  assistantMessageId: 'assistant-1',
  status,
  input: '测试输入',
  partialAnswer: '',
  artifacts: [],
  createdAt: 1,
  updatedAt: 1
})

const settingsStore = (settings: AiRuntimeSettings) => ({
  get: vi.fn(async () => settings)
})

describe('SystemNotificationService', () => {
  it.each([
    ['completed', 'AI 运行已完成'],
    ['failed', 'AI 运行失败'],
    ['cancelled', 'AI 运行已取消']
  ] as const)('notifies %s terminal runs', async (status, title) => {
    const show = vi.fn()
    const on = vi.fn()
    const createNotification = vi.fn(() => ({ show, on }))
    const service = new SystemNotificationService({
      settingsStore: settingsStore({
        llmStreamingMode: 'force_stream',
        systemNotificationsEnabled: true
      }) as never,
      getMainWindow: () => null,
      isSupported: () => true,
      notificationIcon: 'ncurator-icon.png',
      createNotification
    })

    await service.notifyRunTerminal(run(status), status)

    expect(on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(show).toHaveBeenCalledOnce()
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title, icon: 'ncurator-icon.png' })
    )
  })

  it('does not notify when disabled', async () => {
    const createNotification = vi.fn()
    const service = new SystemNotificationService({
      settingsStore: settingsStore({
        llmStreamingMode: 'force_stream',
        systemNotificationsEnabled: false
      }) as never,
      getMainWindow: () => null,
      isSupported: () => true,
      createNotification
    })

    await service.notifyRunTerminal(run(), 'completed')
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('does not notify when the operating system does not support notifications', async () => {
    const createNotification = vi.fn()
    const service = new SystemNotificationService({
      settingsStore: settingsStore({
        llmStreamingMode: 'force_stream',
        systemNotificationsEnabled: true
      }) as never,
      getMainWindow: () => null,
      isSupported: () => false,
      createNotification
    })

    await service.notifyRunTerminal(run(), 'completed')
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('opens the matching partner when the notification is clicked', async () => {
    let clickHandler: (() => void) | undefined
    const window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        send: vi.fn()
      }
    }
    const service = new SystemNotificationService({
      settingsStore: settingsStore({
        llmStreamingMode: 'force_stream',
        systemNotificationsEnabled: true
      }) as never,
      getMainWindow: () => window as never,
      isSupported: () => true,
      createNotification: () => ({
        show: vi.fn(),
        on: (_event, listener) => {
          clickHandler = listener
        }
      })
    })

    await service.notifyRunTerminal(run(), 'completed')
    clickHandler?.()

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.webContents.send).toHaveBeenCalledWith(
      'system-notification-open-session',
      'partner-1'
    )
  })

  it('creates a window before opening the partner when all windows are closed', async () => {
    let clickHandler: (() => void) | undefined
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        send: vi.fn()
      }
    }
    const service = new SystemNotificationService({
      settingsStore: settingsStore({
        llmStreamingMode: 'force_stream',
        systemNotificationsEnabled: true
      }) as never,
      getMainWindow: () => null,
      createMainWindow: () => window as never,
      isSupported: () => true,
      createNotification: () => ({
        show: vi.fn(),
        on: (_event, listener) => {
          clickHandler = listener
        }
      })
    })

    await service.notifyRunTerminal(run(), 'completed')
    clickHandler?.()
    await Promise.resolve()

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.webContents.send).toHaveBeenCalledWith(
      'system-notification-open-session',
      'partner-1'
    )
  })
})

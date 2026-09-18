import { describe, expect, it, vi } from 'vitest'
import {
  SCHEDULED_TASK_PARTNER_BUSY_ERROR,
  ScheduledTaskService,
  boundPartnerName,
  computeNextRunAt
} from '../../../src/main/services/scheduler/ScheduledTaskService'
import type {
  ChatSubmitResponse,
  Partner,
  PartnerUiStateV1,
  ScheduledTask
} from '../../../src/shared/types'

const localAt = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): number => new Date(year, month, day, hours, minutes).getTime()

const NOW = localAt(2026, 0, 1, 8, 0)
const HOUR = 60 * 60 * 1000

const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: '每日晨报',
  prompt: '总结今天的新闻',
  enabled: true,
  scheduleType: 'daily',
  timeOfDay: '09:00',
  weekday: null,
  partnerId: 'partner-1',
  mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
  aiPreference: 'default',
  executionPermission: 'full_access',
  nextRunAt: null,
  busyCancelNoticeAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides
})

const makePartner = (id: string, name = '测试伙伴'): Partner => ({
  id,
  name,
  avatar_shape: 'circle',
  avatar_color: 'blue',
  created_at: 0,
  updated_at: 0,
  last_viewed_at: 0,
  pinned: false,
  pinned_at: null
})

class FakeTaskStore {
  private readonly tasks = new Map<string, ScheduledTask>()

  public set(task: ScheduledTask): void {
    this.tasks.set(task.id, { ...task })
  }

  public save = vi.fn(async (task: ScheduledTask): Promise<void> => {
    this.tasks.set(task.id, { ...task })
  })

  public list = vi.fn(async (): Promise<ScheduledTask[]> => Array.from(this.tasks.values()))

  public listEnabled = vi.fn(
    async (): Promise<ScheduledTask[]> =>
      Array.from(this.tasks.values()).filter((task) => task.enabled)
  )

  public getById = vi.fn(
    async (id: string): Promise<ScheduledTask | null> => this.tasks.get(id) || null
  )

  public delete = vi.fn(async (id: string): Promise<void> => {
    this.tasks.delete(id)
  })
}

type ServiceHarness = {
  taskStore: FakeTaskStore
  partnerStore: {
    getPartner: ReturnType<typeof vi.fn>
    savePartner: ReturnType<typeof vi.fn>
  }
  savePartnerUiState: ReturnType<typeof vi.fn>
  hasActivePartnerRun: ReturnType<typeof vi.fn>
  submitTask: ReturnType<typeof vi.fn>
  emitSessionListRefresh: ReturnType<typeof vi.fn>
  setTimer: ReturnType<typeof vi.fn>
  clearTimer: ReturnType<typeof vi.fn>
  now: ReturnType<typeof vi.fn>
  service: ScheduledTaskService
}

let nextTimerId = 0

const createService = (): ServiceHarness => {
  const taskStore = new FakeTaskStore()
  const partners = new Map<string, Partner>([['partner-1', makePartner('partner-1')]])
  const partnerStore = {
    getPartner: vi.fn(async (id: string) => partners.get(id) || null),
    savePartner: vi.fn(async (partner: Partner) => {
      partners.set(partner.id, partner)
    })
  }
  const savePartnerUiState = vi.fn(async () => undefined)
  const hasActivePartnerRun = vi.fn(() => false)
  const submitTask = vi.fn(async (): Promise<ChatSubmitResponse> => ({ success: true }))
  const emitSessionListRefresh = vi.fn()
  const setTimer = vi.fn(() => ++nextTimerId)
  const clearTimer = vi.fn()
  const now = vi.fn(() => NOW)
  const service = new ScheduledTaskService({
    taskStore,
    partnerStore,
    savePartnerUiState,
    createEmptyPartnerUiState: () =>
      ({
        version: 1,
        composer: {
          aiPreference: 'default',
          executionPermission: 'review',
          modelSelection: { mainModel: null },
          draft: {
            input: '',
            contentNodes: [],
            selectedReferences: [],
            attachments: [],
            assetBucketId: null
          }
        },
        panel: {
          tabs: [],
          activeTabId: null,
          collapsed: true,
          fallbackState: { kind: 'empty', title: '', description: '' }
        }
      }) as PartnerUiStateV1,
    hasActivePartnerRun,
    submitTask,
    emitSessionListRefresh,
    setTimer,
    clearTimer,
    now
  })
  return {
    taskStore,
    partnerStore,
    savePartnerUiState,
    hasActivePartnerRun,
    submitTask,
    emitSessionListRefresh,
    setTimer,
    clearTimer,
    now,
    service
  }
}

describe('ScheduledTaskService', () => {
  it('rejects a save with missing required fields', async () => {
    const { service, taskStore } = createService()
    const base = {
      name: 'x',
      prompt: 'y',
      scheduleType: 'daily' as const,
      timeOfDay: '09:00',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' }
    }
    expect((await service.save({ ...base, name: '  ' })).success).toBe(false)
    expect((await service.save({ ...base, prompt: '' })).success).toBe(false)
    expect(
      (await service.save({ ...base, mainModel: { configId: '', modelName: 'gpt-4o' } })).success
    ).toBe(false)
    expect((await service.save({ ...base, timeOfDay: '25:00' })).success).toBe(false)
    expect((await service.save({ ...base, scheduleType: 'weekly', weekday: null })).success).toBe(
      false
    )
    expect(taskStore.save).not.toHaveBeenCalled()
  })

  it('does not create a bound partner when saving a new task', async () => {
    const { service, partnerStore, savePartnerUiState } = createService()
    const response = await service.save({
      name: '每日晨报',
      prompt: '总结',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' }
    })
    expect(response.success).toBe(true)
    expect(response.task?.partnerId).toBe('')
    expect(response.task?.enabled).toBe(false)
    expect(response.task?.nextRunAt).toBeNull()
    expect(partnerStore.savePartner).not.toHaveBeenCalled()
    expect(savePartnerUiState).not.toHaveBeenCalled()
  })

  it('creates a bound partner when firing a task without partnerId', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ partnerId: '', nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.partnerStore.savePartner).toHaveBeenCalled()
    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    const saved = (await harness.taskStore.list())[0]
    expect(saved.partnerId).toBeTruthy()
    expect(harness.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: saved.partnerId })
    )
    const created = harness.partnerStore.savePartner.mock.calls[0]?.[0] as Partner
    expect(created.name).toBe(boundPartnerName('每日晨报'))
  })

  it('keeps enabled state when editing an enabled task', async () => {
    const { service, taskStore } = createService()
    taskStore.set(
      makeTask({
        enabled: true,
        timeOfDay: '09:00',
        nextRunAt: localAt(2026, 0, 1, 9, 0)
      })
    )
    const response = await service.save({
      id: 'task-1',
      name: '每日晨报改名',
      prompt: '总结今天的新闻',
      scheduleType: 'daily',
      timeOfDay: '10:00',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' }
    })
    expect(response.success).toBe(true)
    expect(response.task?.enabled).toBe(true)
    expect(response.task?.name).toBe('每日晨报改名')
    expect(response.task?.timeOfDay).toBe('10:00')
    expect(response.task?.nextRunAt).toBe(localAt(2026, 0, 1, 10, 0))
  })

  it('keeps a disabled task disabled when editing', async () => {
    const { service, taskStore } = createService()
    taskStore.set(makeTask({ enabled: false, nextRunAt: null }))
    const response = await service.save({
      id: 'task-1',
      name: '每日晨报改名',
      prompt: '总结今天的新闻',
      scheduleType: 'daily',
      timeOfDay: '10:00',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' }
    })
    expect(response.success).toBe(true)
    expect(response.task?.enabled).toBe(false)
    expect(response.task?.nextRunAt).toBeNull()
  })

  it('returns an error when enabling a missing task', async () => {
    const { service } = createService()
    const response = await service.setEnabled({ id: 'missing', enabled: true })
    expect(response.success).toBe(false)
    expect(response.error).toBe('定时任务不存在')
  })

  it('fires a due task, submits to the partner and refreshes the list', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    expect(harness.submitTask).toHaveBeenCalledWith({
      partnerId: 'partner-1',
      input: '总结今天的新闻',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
      preference: 'default',
      executionPermission: 'full_access'
    })
    expect(harness.emitSessionListRefresh).toHaveBeenCalled()
  })

  it('re-arms the timer to the next run after firing a due task', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.setTimer).toHaveBeenCalledTimes(1)
    expect(harness.setTimer).toHaveBeenCalledWith(expect.any(Function), HOUR)
  })

  it('advances next run when submit fails', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    harness.submitTask.mockResolvedValueOnce({ success: false, error: '模型失效' })

    await harness.service.runDue()

    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    const saved = (await harness.taskStore.list())[0]
    expect(saved.nextRunAt).toBe(localAt(2026, 0, 1, 9, 0))
  })

  it('rebuilds a missing partner then fires', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ partnerId: 'gone', nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.partnerStore.savePartner).toHaveBeenCalled()
    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    const saved = (await harness.taskStore.list())[0]
    expect(saved.partnerId).not.toBe('gone')
    expect(harness.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: saved.partnerId })
    )
  })

  it('cancels due run when partner is busy and writes busy notice', async () => {
    const harness = createService()
    harness.hasActivePartnerRun.mockReturnValue(true)
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.submitTask).not.toHaveBeenCalled()
    const saved = (await harness.taskStore.list())[0]
    expect(saved.busyCancelNoticeAt).toBe(NOW)
    expect(saved.nextRunAt).toBe(localAt(2026, 0, 1, 9, 0))
    expect(harness.emitSessionListRefresh).toHaveBeenCalled()
  })

  it('runNow submits and clears busy notice when idle', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ busyCancelNoticeAt: NOW }))
    const response = await harness.service.runNow({ id: 'task-1' })
    expect(response.success).toBe(true)
    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    expect(response.task?.busyCancelNoticeAt).toBeNull()
  })

  it('runNow returns busy error when partner is active', async () => {
    const harness = createService()
    harness.hasActivePartnerRun.mockReturnValue(true)
    harness.taskStore.set(makeTask())
    const response = await harness.service.runNow({ id: 'task-1' })
    expect(response.success).toBe(false)
    expect(response.error).toBe(SCHEDULED_TASK_PARTNER_BUSY_ERROR)
    expect(harness.submitTask).not.toHaveBeenCalled()
  })

  it('dismissBusyNotice clears the notice without submitting', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ busyCancelNoticeAt: NOW }))
    const response = await harness.service.dismissBusyNotice({ id: 'task-1' })
    expect(response.success).toBe(true)
    expect(response.task?.busyCancelNoticeAt).toBeNull()
    expect(harness.submitTask).not.toHaveBeenCalled()
  })

  it('advances missed runs on start instead of firing them', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 60_000 }))
    await harness.service.start()

    expect(harness.submitTask).not.toHaveBeenCalled()
    const saved = (await harness.taskStore.list())[0]
    expect(saved.nextRunAt).not.toBeNull()
    expect(saved.nextRunAt).toBeGreaterThan(NOW)
  })

  it('skips and advances a run that was missed while asleep', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 2 * HOUR }))
    await harness.service.runDue()

    expect(harness.submitTask).not.toHaveBeenCalled()
    const saved = (await harness.taskStore.list())[0]
    expect(saved.nextRunAt).toBe(localAt(2026, 0, 1, 9, 0))
  })

  it('fires every due task when multiple tasks share the same slot', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ id: 'task-1', nextRunAt: NOW - 1 }))
    harness.taskStore.set(
      makeTask({ id: 'task-2', name: '晚间摘要', timeOfDay: '20:00', nextRunAt: NOW - 1 })
    )
    await harness.service.runDue()

    expect(harness.submitTask).toHaveBeenCalledTimes(2)
  })

  it('arms a timer when a task is enabled', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ enabled: false, nextRunAt: null }))
    await harness.service.start()
    expect(harness.setTimer).not.toHaveBeenCalled()

    await harness.service.setEnabled({ id: 'task-1', enabled: true })
    expect(harness.setTimer).toHaveBeenCalledTimes(1)
    expect(harness.setTimer).toHaveBeenCalledWith(expect.any(Function), HOUR)
  })

  it('does not arm a timer when there are no enabled tasks', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ enabled: false, nextRunAt: null }))
    await harness.service.start()

    expect(harness.setTimer).not.toHaveBeenCalled()
  })

  it('re-arms to the earliest enabled task after a delete', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ id: 'task-1', nextRunAt: NOW + HOUR }))
    harness.taskStore.set(
      makeTask({ id: 'task-2', name: '晚间摘要', timeOfDay: '20:00', nextRunAt: NOW + 12 * HOUR })
    )
    await harness.service.start()
    expect(harness.setTimer).toHaveBeenLastCalledWith(expect.any(Function), HOUR)

    await harness.service.delete('task-1')
    expect(harness.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 12 * HOUR)
  })
})

describe('computeNextRunAt', () => {
  it('returns today slot for a daily task when the time is still ahead', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '09:00', weekday: null }, after)
    ).toBe(localAt(2026, 7, 20, 9, 0))
  })

  it('rolls to tomorrow for a daily task when the time already passed', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '07:00', weekday: null }, after)
    ).toBe(localAt(2026, 7, 21, 7, 0))
  })

  it('returns later today for a weekly task on the same weekday', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 4 }, after)
    ).toBe(localAt(2026, 7, 20, 9, 0))
  })

  it('rolls to next week for a weekly task whose time already passed', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '07:00', weekday: 4 }, after)
    ).toBe(localAt(2026, 7, 27, 7, 0))
  })

  it('returns a later weekday within the same week', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 5 }, after)
    ).toBe(localAt(2026, 7, 21, 9, 0))
  })

  it('wraps to the following week for an earlier weekday', () => {
    const after = localAt(2026, 7, 20, 8, 0)
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 2 }, after)
    ).toBe(localAt(2026, 7, 25, 9, 0))
  })

  it('returns null for an invalid time of day', () => {
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '25:00', weekday: null }, Date.now())
    ).toBeNull()
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '9', weekday: null }, Date.now())
    ).toBeNull()
  })

  it('returns null for a weekly task without a valid weekday', () => {
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: null }, Date.now())
    ).toBeNull()
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: 7 }, Date.now())
    ).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  ScheduledTaskService,
  computeNextRunAt
} from '../../../src/main/services/scheduler/ScheduledTaskService'
import type {
  ChatMessageContentNode,
  ChatSubmitResponse,
  Partner,
  PartnerUiStateV1,
  SelectedReference,
  ScheduledTask
} from '../../../src/shared/types'

const NOW = new Date(2026, 0, 1, 8, 0).getTime()
const partner: Partner = {
  id: 'partner-1',
  name: '测试伙伴',
  avatar_shape: 'circle',
  avatar_color: 'blue',
  created_at: 0,
  updated_at: 0,
  last_viewed_at: 0,
  pinned: false,
  pinned_at: null
}
const uiState: PartnerUiStateV1 = {
  version: 1,
  composer: {
    aiPreference: 'local_sources_strict',
    executionPermission: 'full_access',
    modelSelection: { mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' } },
    draft: {
      formatVersion: 2,
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
}
const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: '每日晨报',
  description: '总结今天的新闻',
  contentNodes: [],
  selectedReferences: [],
  enabled: true,
  scheduleType: 'daily',
  timeOfDay: '09:00',
  weekday: null,
  partnerId: 'partner-1',
  nextRunAt: null,
  busyCancelNoticeAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides
})

class FakeTaskStore {
  private readonly tasks = new Map<string, ScheduledTask>()
  public set(task: ScheduledTask): void {
    this.tasks.set(task.id, { ...task })
  }
  public save = vi.fn(async (task: ScheduledTask) => {
    this.tasks.set(task.id, { ...task })
  })
  public list = vi.fn(async () => [...this.tasks.values()])
  public listEnabled = vi.fn(async () => [...this.tasks.values()].filter((task) => task.enabled))
  public listByPartner = vi.fn(async (partnerId: string) =>
    [...this.tasks.values()].filter((task) => task.partnerId === partnerId)
  )
  public getById = vi.fn(async (id: string) => this.tasks.get(id) || null)
  public delete = vi.fn(async (id: string) => {
    this.tasks.delete(id)
  })
}

const createService = () => {
  const taskStore = new FakeTaskStore()
  const partnerStore = {
    getPartner: vi.fn(async (id: string) => (id === partner.id ? partner : null))
  }
  const getPartnerUiState = vi.fn(async () => uiState)
  const submitTask = vi.fn(async (): Promise<ChatSubmitResponse> => ({ success: true }))
  const hasActivePartnerRun = vi.fn(() => false)
  const emitSessionListRefresh = vi.fn()
  const now = vi.fn(() => NOW)
  const service = new ScheduledTaskService({
    taskStore,
    partnerStore,
    getPartnerUiState,
    hasActivePartnerRun,
    submitTask,
    emitSessionListRefresh,
    now,
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn()
  })
  return {
    service,
    taskStore,
    partnerStore,
    getPartnerUiState,
    submitTask,
    hasActivePartnerRun,
    emitSessionListRefresh,
    now
  }
}

describe('ScheduledTaskService', () => {
  it('advances busy due tasks once without queueing a catch-up run', async () => {
    const { service, taskStore, submitTask, hasActivePartnerRun, emitSessionListRefresh } =
      createService()
    taskStore.set(makeTask({ nextRunAt: NOW }))
    hasActivePartnerRun.mockReturnValue(true)

    await service.runDue()
    const postponed = await taskStore.getById('task-1')
    expect(postponed).toMatchObject({
      busyCancelNoticeAt: NOW,
      nextRunAt: new Date(2026, 0, 1, 9, 0).getTime()
    })
    expect(submitTask).not.toHaveBeenCalled()
    expect(emitSessionListRefresh).toHaveBeenCalledOnce()

    hasActivePartnerRun.mockReturnValue(false)
    await service.runDue()
    expect(await taskStore.getById('task-1')).toEqual(postponed)
    expect(taskStore.save).toHaveBeenCalledOnce()
    expect(submitTask).not.toHaveBeenCalled()
  })

  it('skips missed startup schedules even within the running grace period', async () => {
    const { service, taskStore, submitTask } = createService()
    taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await service.start()
    await service.runDue()
    expect(submitTask).not.toHaveBeenCalled()
    expect((await taskStore.getById('task-1'))?.nextRunAt).toBe(
      new Date(2026, 0, 1, 9, 0).getTime()
    )
    service.stop()
  })

  it.each([60_000, 60_001])('handles a running scheduler waking %i ms late', async (delay) => {
    const { service, taskStore, submitTask, now } = createService()
    const due = new Date(2026, 0, 1, 9, 0).getTime()
    taskStore.set(makeTask({ nextRunAt: due }))
    await service.start()
    now.mockReturnValue(due + delay)
    await service.runDue()
    expect(submitTask).toHaveBeenCalledTimes(delay === 60_000 ? 1 : 0)
    expect((await taskStore.getById('task-1'))?.nextRunAt).toBe(
      new Date(2026, 0, 2, 9, 0).getTime()
    )
    await service.runDue()
    expect(submitTask).toHaveBeenCalledTimes(delay === 60_000 ? 1 : 0)
    service.stop()
  })

  it('rejects run-now while busy and preserves the schedule on a later manual run', async () => {
    const { service, taskStore, submitTask, hasActivePartnerRun } = createService()
    const task = makeTask({ nextRunAt: NOW + 3_600_000, busyCancelNoticeAt: NOW - 1 })
    taskStore.set(task)
    hasActivePartnerRun.mockReturnValue(true)
    expect(await service.runNow({ id: task.id })).toMatchObject({
      success: false,
      error: '请等待当前任务结束，或先停止后再执行'
    })
    expect(submitTask).not.toHaveBeenCalled()
    expect(taskStore.save).not.toHaveBeenCalled()

    hasActivePartnerRun.mockReturnValue(false)
    expect(await service.runNow({ id: task.id })).toMatchObject({ success: true })
    expect(submitTask).toHaveBeenCalledOnce()
    expect(await taskStore.getById(task.id)).toMatchObject({
      nextRunAt: task.nextRunAt,
      busyCancelNoticeAt: null
    })
  })

  it('dismisses only the busy notice without executing or rescheduling', async () => {
    const { service, taskStore, submitTask } = createService()
    const task = makeTask({ nextRunAt: NOW + 3_600_000, busyCancelNoticeAt: NOW - 1 })
    taskStore.set(task)
    expect(await service.dismissBusyNotice({ id: task.id })).toMatchObject({ success: true })
    expect(await taskStore.getById(task.id)).toEqual({ ...task, busyCancelNoticeAt: null })
    expect(submitTask).not.toHaveBeenCalled()
  })

  it('requires an existing partner and creates enabled tasks', async () => {
    const { service, taskStore } = createService()
    const response = await service.save({
      name: '每日晨报',
      description: '总结',
      partnerId: 'partner-1',
      scheduleType: 'daily',
      timeOfDay: '09:00'
    })
    expect(response.success).toBe(true)
    expect(response.task?.enabled).toBe(true)
    expect(response.task?.partnerId).toBe('partner-1')
    expect(taskStore.save).toHaveBeenCalled()
    expect(
      (
        await service.save({
          name: 'x',
          description: 'y',
          partnerId: '',
          scheduleType: 'daily',
          timeOfDay: '09:00'
        })
      ).success
    ).toBe(false)
  })

  it('updates enabled explicitly and preserves it on later edits', async () => {
    const { service } = createService()
    const created = await service.save({
      name: '每日晨报',
      description: '总结',
      partnerId: 'partner-1',
      scheduleType: 'daily',
      timeOfDay: '09:00'
    })
    const id = created.task?.id
    expect(id).toBeTruthy()

    const disabled = await service.save({
      id,
      name: '每日晨报',
      description: '总结',
      partnerId: 'partner-1',
      scheduleType: 'daily',
      timeOfDay: '10:00',
      enabled: false
    })
    expect(disabled.task?.enabled).toBe(false)
    expect(disabled.task?.nextRunAt).toBeNull()

    const edited = await service.save({
      id,
      name: '每日晨报已编辑',
      description: '总结',
      partnerId: 'partner-1',
      scheduleType: 'daily',
      timeOfDay: '11:00'
    })
    expect(edited.task?.enabled).toBe(false)
    expect(edited.task?.nextRunAt).toBeNull()
  })

  it('reads the latest partner composer settings when running', async () => {
    const { service, taskStore, submitTask, getPartnerUiState } = createService()
    const reference: SelectedReference = {
      kind: 'file',
      name: 'brief.docx',
      absolutePath: '/tmp/brief.docx'
    }
    const contentNodes: ChatMessageContentNode[] = [
      { kind: 'text', text: '总结资料' },
      { kind: 'reference', reference }
    ]
    taskStore.set(
      makeTask({
        nextRunAt: NOW - 1,
        contentNodes
      })
    )
    await service.runDue()
    expect(getPartnerUiState).toHaveBeenCalledWith('partner-1')
    expect(submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        mainModel: uiState.composer.modelSelection.mainModel,
        preference: 'local_sources_strict',
        executionPermission: 'full_access',
        contentNodes
      })
    )
  })

  it('fails clearly when the partner has no main model', async () => {
    const { taskStore, submitTask } = createService()
    taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    const stateWithoutModel = {
      ...uiState,
      composer: { ...uiState.composer, modelSelection: { mainModel: null } }
    }
    const serviceWithoutModel = new ScheduledTaskService({
      taskStore,
      partnerStore: { getPartner: vi.fn(async () => partner) },
      getPartnerUiState: async () => stateWithoutModel,
      hasActivePartnerRun: () => false,
      submitTask,
      emitSessionListRefresh: vi.fn(),
      now: () => NOW,
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn()
    })
    await serviceWithoutModel.runDue()
    expect(submitTask).not.toHaveBeenCalled()
  })

  it('stops a task when its partner no longer exists', async () => {
    const { taskStore } = createService()
    taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    const missingPartnerService = new ScheduledTaskService({
      taskStore,
      partnerStore: { getPartner: vi.fn(async () => null) },
      getPartnerUiState: async () => uiState,
      hasActivePartnerRun: () => false,
      submitTask: vi.fn(async () => ({ success: true })),
      emitSessionListRefresh: vi.fn(),
      now: () => NOW,
      setTimer: vi.fn(() => 1),
      clearTimer: vi.fn()
    })
    await missingPartnerService.runDue()
    expect((await taskStore.getById('task-1'))?.enabled).toBe(false)
    expect((await taskStore.getById('task-1'))?.partnerId).toBe('')
  })

  it('computes daily and weekly slots and rejects invalid schedules', () => {
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '09:00', weekday: null }, NOW)
    ).toBe(new Date(2026, 0, 1, 9, 0).getTime())
    expect(
      computeNextRunAt({ scheduleType: 'weekly', timeOfDay: '09:00', weekday: null }, NOW)
    ).toBeNull()
    expect(
      computeNextRunAt({ scheduleType: 'daily', timeOfDay: '25:00', weekday: null }, NOW)
    ).toBeNull()
  })
})

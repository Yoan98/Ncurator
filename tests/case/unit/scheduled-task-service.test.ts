import { describe, expect, it, vi } from 'vitest'
import { ScheduledTaskService } from '../../../src/main/services/scheduler/ScheduledTaskService'
import type {
  ChatSubmitResponse,
  ScheduledTask,
  WorkspaceSource
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
  workspaceId: 'ws-1',
  mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
  visionModel: null,
  aiPreference: 'default',
  executionPermission: 'full_access',
  nextRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides
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
    async (): Promise<ScheduledTask[]> => Array.from(this.tasks.values()).filter((task) => task.enabled)
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
  workspaceStore: { getWorkspaceById: ReturnType<typeof vi.fn> }
  chatStore: { saveChatSession: ReturnType<typeof vi.fn>; deleteChatSession: ReturnType<typeof vi.fn> }
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
  const workspaceStore = {
    getWorkspaceById: vi.fn(async (id: string): Promise<WorkspaceSource | null> =>
      id === 'ws-1'
        ? { id: 'ws-1', name: '工作区', root_path: '/workspace', created_at: 0, updated_at: 0 }
        : null
    )
  }
  const chatStore = {
    saveChatSession: vi.fn(async (): Promise<void> => {}),
    deleteChatSession: vi.fn(async (): Promise<void> => {})
  }
  const submitTask = vi.fn(
    async (): Promise<ChatSubmitResponse> => ({ success: true, mode: 'ai' })
  )
  const emitSessionListRefresh = vi.fn()
  const setTimer = vi.fn(() => ++nextTimerId)
  const clearTimer = vi.fn()
  const now = vi.fn(() => NOW)
  const service = new ScheduledTaskService({
    taskStore,
    workspaceStore,
    chatStore,
    submitTask,
    emitSessionListRefresh,
    setTimer,
    clearTimer,
    now
  })
  return {
    taskStore,
    workspaceStore,
    chatStore,
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
      workspaceId: 'ws-1',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
      enabled: false
    }
    expect((await service.save({ ...base, name: '  ' })).success).toBe(false)
    expect((await service.save({ ...base, prompt: '' })).success).toBe(false)
    expect((await service.save({ ...base, workspaceId: '' })).success).toBe(false)
    expect(
      (await service.save({ ...base, mainModel: { configId: '', modelName: 'gpt-4o' } })).success
    ).toBe(false)
    expect((await service.save({ ...base, timeOfDay: '25:00' })).success).toBe(false)
    expect(
      (await service.save({ ...base, scheduleType: 'weekly', weekday: null })).success
    ).toBe(false)
    expect(taskStore.save).not.toHaveBeenCalled()
  })

  it('computes nextRunAt when saving an enabled daily task', async () => {
    const { service, taskStore } = createService()
    const response = await service.save({
      name: '每日晨报',
      prompt: '总结',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      workspaceId: 'ws-1',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
      enabled: true
    })
    expect(response.success).toBe(true)
    expect(response.task?.enabled).toBe(true)
    expect(response.task?.nextRunAt).toBe(localAt(2026, 0, 1, 9, 0))
    expect(taskStore.save).toHaveBeenCalledTimes(1)
  })

  it('does not compute nextRunAt for a disabled task', async () => {
    const { service } = createService()
    const response = await service.save({
      name: 'x',
      prompt: 'y',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      workspaceId: 'ws-1',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
      enabled: false
    })
    expect(response.success).toBe(true)
    expect(response.task?.nextRunAt).toBeNull()
  })

  it('returns an error when enabling a missing task', async () => {
    const { service } = createService()
    const response = await service.setEnabled({ id: 'missing', enabled: true })
    expect(response.success).toBe(false)
    expect(response.error).toBe('定时任务不存在')
  })

  it('fires a due task, creates a session, submits with the configured context and refreshes the list', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.chatStore.saveChatSession).toHaveBeenCalledTimes(1)
    expect(harness.chatStore.saveChatSession).toHaveBeenCalledWith({
      id: expect.any(String),
      title: '每日晨报',
      created_at: NOW,
      workspace_id: 'ws-1'
    })

    expect(harness.submitTask).toHaveBeenCalledTimes(1)
    expect(harness.submitTask).toHaveBeenCalledWith({
      mode: 'ai',
      sessionId: expect.any(String),
      input: '总结今天的新闻',
      mainModel: { configId: 'cfg-1', modelName: 'gpt-4o' },
      visionModel: undefined,
      preference: 'default',
      executionPermission: 'full_access',
      workspace: { workspaceId: 'ws-1', workspaceName: '工作区', rootPath: '/workspace' }
    })
    expect(harness.emitSessionListRefresh).toHaveBeenCalledTimes(1)
    expect(harness.chatStore.deleteChatSession).not.toHaveBeenCalled()
  })

  it('re-arms the timer to the next run after firing a due task', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.setTimer).toHaveBeenCalledTimes(1)
    expect(harness.setTimer).toHaveBeenCalledWith(expect.any(Function), HOUR)
  })

  it('cleans up the empty session and skips refresh when submit fails', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 1 }))
    harness.submitTask.mockResolvedValueOnce({ success: false, error: '模型失效' })

    await harness.service.runDue()

    expect(harness.chatStore.saveChatSession).toHaveBeenCalledTimes(1)
    expect(harness.chatStore.deleteChatSession).toHaveBeenCalledTimes(1)
    expect(harness.emitSessionListRefresh).not.toHaveBeenCalled()
  })

  it('skips without creating a session when the workspace is missing', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ workspaceId: 'gone', nextRunAt: NOW - 1 }))
    await harness.service.runDue()

    expect(harness.chatStore.saveChatSession).not.toHaveBeenCalled()
    expect(harness.submitTask).not.toHaveBeenCalled()
    expect(harness.emitSessionListRefresh).not.toHaveBeenCalled()
  })

  it('advances missed runs on start instead of firing them', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 60_000 }))
    await harness.service.start()

    expect(harness.submitTask).not.toHaveBeenCalled()
    const stored = harness.taskStore.list()
    const saved = (await stored)[0]
    expect(saved.nextRunAt).not.toBeNull()
    expect(saved.nextRunAt).toBeGreaterThan(NOW)
  })

  it('skips and advances a run that was missed while asleep', async () => {
    const harness = createService()
    harness.taskStore.set(makeTask({ nextRunAt: NOW - 2 * HOUR }))
    await harness.service.runDue()

    expect(harness.submitTask).not.toHaveBeenCalled()
    expect(harness.chatStore.saveChatSession).not.toHaveBeenCalled()
    const stored = harness.taskStore.list()
    const saved = (await stored)[0]
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
    expect(harness.chatStore.saveChatSession).toHaveBeenCalledTimes(2)
    expect(harness.emitSessionListRefresh).toHaveBeenCalledTimes(2)
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

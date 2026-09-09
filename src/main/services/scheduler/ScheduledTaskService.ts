import { v4 as uuidv4 } from 'uuid'
import type {
  AiExecutionPermission,
  AiPreference,
  ChatSubmitRequest,
  ChatSubmitResponse,
  Partner,
  PartnerAvatarColor,
  PartnerAvatarShape,
  PartnerUiStateV1,
  ScheduledTask,
  ScheduledTaskDismissBusyNoticeRequest,
  ScheduledTaskMutationResponse,
  ScheduledTaskRunNowRequest,
  ScheduledTaskSaveRequest,
  ScheduledTaskScheduleType,
  ScheduledTaskSetEnabledRequest
} from '../../../shared/types'
import { PARTNER_AVATAR_COLORS, PARTNER_AVATAR_SHAPES } from '../../../shared/types'
import type { PartnerStore } from '../storage/domains/PartnerStore'
import type { ScheduledTaskStore } from '../storage/domains/ScheduledTaskStore'

const MISFIRE_GRACE_MS = 60_000
const PARTNER_BUSY_ERROR = '请等待当前任务结束，或先停止后再执行'

type TimerHandle = ReturnType<typeof setTimeout>

type ScheduledTaskServiceDeps = {
  taskStore: Pick<ScheduledTaskStore, 'list' | 'listEnabled' | 'getById' | 'save' | 'delete'>
  partnerStore: Pick<PartnerStore, 'getPartner' | 'savePartner'>
  savePartnerUiState: (partnerId: string, state: PartnerUiStateV1) => Promise<void>
  createEmptyPartnerUiState: () => PartnerUiStateV1
  hasActivePartnerRun: (partnerId: string) => boolean
  submitTask: (payload: ChatSubmitRequest) => Promise<ChatSubmitResponse>
  emitSessionListRefresh: () => void
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  now?: () => number
}

const normalizeScheduleType = (value: unknown): ScheduledTaskScheduleType =>
  value === 'weekly' ? 'weekly' : 'daily'

const normalizeAiPreference = (value: unknown): AiPreference =>
  value === 'local_sources_relaxed' || value === 'local_sources_strict' ? value : 'default'

const normalizeExecutionPermission = (value: unknown): AiExecutionPermission =>
  value === 'full_access' ? 'full_access' : 'review'

const parseTimeOfDay = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const slotEpochForDate = (year: number, month: number, day: number, minutesOfDay: number): number => {
  const date = new Date(year, month, day)
  date.setMinutes(minutesOfDay)
  return date.getTime()
}

const nextDailySlot = (after: number, minutesOfDay: number): number => {
  const current = new Date(after)
  const todaySlot = slotEpochForDate(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
    minutesOfDay
  )
  if (todaySlot > after) return todaySlot
  return slotEpochForDate(current.getFullYear(), current.getMonth(), current.getDate() + 1, minutesOfDay)
}

const nextWeeklySlot = (after: number, minutesOfDay: number, weekday: number): number => {
  const current = new Date(after)
  const daysUntil = (weekday - current.getDay() + 7) % 7
  const target = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + daysUntil
  )
  const slot = slotEpochForDate(target.getFullYear(), target.getMonth(), target.getDate(), minutesOfDay)
  if (slot > after) return slot
  return slotEpochForDate(target.getFullYear(), target.getMonth(), target.getDate() + 7, minutesOfDay)
}

export const computeNextRunAt = (
  input: { scheduleType: ScheduledTaskScheduleType; timeOfDay: string; weekday: number | null },
  after: number
): number | null => {
  const minutesOfDay = parseTimeOfDay(input.timeOfDay)
  if (minutesOfDay === null) return null
  if (input.scheduleType === 'weekly') {
    if (input.weekday === null || input.weekday < 0 || input.weekday > 6) return null
    return nextWeeklySlot(after, minutesOfDay, input.weekday)
  }
  return nextDailySlot(after, minutesOfDay)
}

export const boundPartnerName = (taskName: string): string => `定时 · ${taskName.trim()}`

const hashSeed = (value: string): number => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

const avatarForTaskId = (
  taskId: string
): { avatar_shape: PartnerAvatarShape; avatar_color: PartnerAvatarColor } => {
  const seed = hashSeed(taskId)
  return {
    avatar_shape: PARTNER_AVATAR_SHAPES[seed % PARTNER_AVATAR_SHAPES.length],
    avatar_color: PARTNER_AVATAR_COLORS[(seed >>> 8) % PARTNER_AVATAR_COLORS.length]
  }
}

export class ScheduledTaskService {
  private readonly deps: Required<Pick<ScheduledTaskServiceDeps, 'setTimer' | 'clearTimer' | 'now'>> &
    Omit<ScheduledTaskServiceDeps, 'setTimer' | 'clearTimer' | 'now'>
  private timer: TimerHandle | null = null
  private running = false

  public constructor(deps: ScheduledTaskServiceDeps) {
    this.deps = {
      setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimer: (handle) => clearTimeout(handle),
      now: () => Date.now(),
      ...deps
    }
  }

  public async start(): Promise<void> {
    try {
      await this.reconcileMissed()
    } catch (error) {
      console.error('[SCHEDULED-TASK] reconcile missed failed:', error)
    }
    await this.scheduleNext()
  }

  public stop(): void {
    if (this.timer === null) return
    this.deps.clearTimer(this.timer)
    this.timer = null
  }

  public async runDue(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const now = this.deps.now()
      const tasks = await this.deps.taskStore.listEnabled()
      for (const task of tasks) {
        if (task.nextRunAt === null || now < task.nextRunAt) continue
        if (now - task.nextRunAt <= MISFIRE_GRACE_MS) {
          await this.fireTask(task, now)
        } else {
          console.log(
            '[SCHEDULED-TASK] missed slot, skip:',
            JSON.stringify({ id: task.id, nextRunAt: task.nextRunAt, now, gapMs: now - task.nextRunAt })
          )
          await this.advanceNextRun(task, now)
        }
      }
    } catch (error) {
      console.error('[SCHEDULED-TASK] run due failed:', error)
    } finally {
      this.running = false
    }
    await this.scheduleNext()
  }

  private async scheduleNext(): Promise<void> {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer)
      this.timer = null
    }
    const now = this.deps.now()
    const tasks = await this.deps.taskStore.listEnabled()
    const next = tasks
      .map((task) => task.nextRunAt)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)[0]
    if (next === undefined) return
    const delayMs = Math.max(0, next - now)
    console.warn(
      '[SCHEDULED-TASK] arm timer:',
      JSON.stringify({ next, now, delayMs })
    )
    this.timer = this.deps.setTimer(() => {
      void this.runDue()
    }, delayMs)
  }

  public async list(): Promise<ScheduledTask[]> {
    return this.deps.taskStore.list()
  }

  public async save(input: ScheduledTaskSaveRequest): Promise<ScheduledTaskMutationResponse> {
    try {
      const task = await this.buildTask(input)
      await this.deps.taskStore.save(task)
      await this.scheduleNext()
      this.deps.emitSessionListRefresh()
      return { success: true, task }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public async delete(id: string): Promise<ScheduledTaskMutationResponse> {
    try {
      await this.deps.taskStore.delete(String(id || '').trim())
      await this.scheduleNext()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public async setEnabled(
    input: ScheduledTaskSetEnabledRequest
  ): Promise<ScheduledTaskMutationResponse> {
    try {
      const existing = await this.deps.taskStore.getById(String(input.id || '').trim())
      if (!existing) return { success: false, error: '定时任务不存在' }
      const enabled = Boolean(input.enabled)
      const now = this.deps.now()
      const task: ScheduledTask = {
        ...existing,
        enabled,
        nextRunAt: enabled ? computeNextRunAt(existing, now) : null,
        updatedAt: now
      }
      await this.deps.taskStore.save(task)
      await this.scheduleNext()
      return { success: true, task }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public async runNow(input: ScheduledTaskRunNowRequest): Promise<ScheduledTaskMutationResponse> {
    try {
      const existing = await this.deps.taskStore.getById(String(input.id || '').trim())
      if (!existing) return { success: false, error: '定时任务不存在' }
      const ensured = await this.ensureBoundPartner(existing)
      if (this.deps.hasActivePartnerRun(ensured.partnerId)) {
        return { success: false, error: PARTNER_BUSY_ERROR }
      }
      const response = await this.deps.submitTask({
        partnerId: ensured.partnerId,
        input: ensured.prompt,
        mainModel: ensured.mainModel,
        preference: ensured.aiPreference,
        executionPermission: ensured.executionPermission
      })
      if (!response.success) {
        return { success: false, error: response.error || '立即执行失败' }
      }
      const now = this.deps.now()
      const cleared: ScheduledTask = {
        ...ensured,
        busyCancelNoticeAt: null,
        updatedAt: now
      }
      await this.deps.taskStore.save(cleared)
      this.deps.emitSessionListRefresh()
      return { success: true, task: cleared }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  public async dismissBusyNotice(
    input: ScheduledTaskDismissBusyNoticeRequest
  ): Promise<ScheduledTaskMutationResponse> {
    try {
      const existing = await this.deps.taskStore.getById(String(input.id || '').trim())
      if (!existing) return { success: false, error: '定时任务不存在' }
      const now = this.deps.now()
      const task: ScheduledTask = {
        ...existing,
        busyCancelNoticeAt: null,
        updatedAt: now
      }
      await this.deps.taskStore.save(task)
      this.deps.emitSessionListRefresh()
      return { success: true, task }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async buildTask(input: ScheduledTaskSaveRequest): Promise<ScheduledTask> {
    const name = String(input.name || '').trim()
    const prompt = String(input.prompt || '').trim()
    const mainModel = input.mainModel
    const scheduleType = normalizeScheduleType(input.scheduleType)
    if (!name) throw new Error('请填写任务名称')
    if (!prompt) throw new Error('请填写任务提示词')
    if (!mainModel?.configId || !mainModel?.modelName) throw new Error('请选择主模型')
    if (parseTimeOfDay(input.timeOfDay) === null) throw new Error('执行时间格式不正确')

    const weekday = scheduleType === 'weekly' ? normalizeWeekday(input.weekday) : null
    if (scheduleType === 'weekly' && weekday === null) throw new Error('请选择星期几')
    const now = this.deps.now()
    const existingId = String(input.id || '').trim()
    const id = existingId || uuidv4()
    const schedule = {
      scheduleType,
      timeOfDay: String(input.timeOfDay || '').trim(),
      weekday
    }

    let partnerId = ''
    let busyCancelNoticeAt: number | null = null
    let createdAt = now
    let enabled = false
    if (existingId) {
      const existing = await this.deps.taskStore.getById(existingId)
      if (!existing) throw new Error('定时任务不存在')
      partnerId = existing.partnerId
      busyCancelNoticeAt = existing.busyCancelNoticeAt
      createdAt = existing.createdAt
      enabled = existing.enabled
      await this.syncBoundPartnerName(partnerId, name)
    } else {
      partnerId = await this.createBoundPartner(id, name, now)
    }

    return {
      id,
      name,
      prompt,
      enabled,
      scheduleType,
      timeOfDay: schedule.timeOfDay,
      weekday,
      partnerId,
      mainModel: { configId: mainModel.configId, modelName: mainModel.modelName },
      aiPreference: normalizeAiPreference(input.aiPreference),
      executionPermission: normalizeExecutionPermission(input.executionPermission),
      nextRunAt: enabled ? computeNextRunAt(schedule, now) : null,
      busyCancelNoticeAt,
      createdAt,
      updatedAt: now
    }
  }

  private async createBoundPartner(taskId: string, taskName: string, now: number): Promise<string> {
    const avatar = avatarForTaskId(taskId)
    const partner: Partner = {
      id: uuidv4(),
      name: boundPartnerName(taskName),
      avatar_shape: avatar.avatar_shape,
      avatar_color: avatar.avatar_color,
      created_at: now,
      updated_at: now,
      last_viewed_at: now,
      pinned: false,
      pinned_at: null
    }
    await this.deps.partnerStore.savePartner(partner)
    await this.deps.savePartnerUiState(partner.id, this.deps.createEmptyPartnerUiState())
    return partner.id
  }

  private async syncBoundPartnerName(partnerId: string, taskName: string): Promise<void> {
    const partner = await this.deps.partnerStore.getPartner(partnerId)
    if (!partner) return
    const nextName = boundPartnerName(taskName)
    if (partner.name === nextName) return
    await this.deps.partnerStore.savePartner({
      ...partner,
      name: nextName,
      updated_at: this.deps.now()
    })
  }

  private async ensureBoundPartner(task: ScheduledTask): Promise<ScheduledTask> {
    const partnerId = String(task.partnerId || '').trim()
    if (partnerId) {
      const existing = await this.deps.partnerStore.getPartner(partnerId)
      if (existing) return task
    }
    const now = this.deps.now()
    const createdId = await this.createBoundPartner(task.id, task.name, now)
    const updated: ScheduledTask = {
      ...task,
      partnerId: createdId,
      updatedAt: now
    }
    await this.deps.taskStore.save(updated)
    this.deps.emitSessionListRefresh()
    return updated
  }

  private async reconcileMissed(): Promise<void> {
    const now = this.deps.now()
    const tasks = await this.deps.taskStore.listEnabled()
    for (const task of tasks) {
      if (task.nextRunAt !== null && task.nextRunAt <= now) {
        await this.deps.taskStore.save({
          ...task,
          nextRunAt: computeNextRunAt(task, now),
          updatedAt: now
        })
      }
    }
  }

  private async fireTask(task: ScheduledTask, now: number): Promise<void> {
    let working = task
    try {
      working = await this.ensureBoundPartner(task)
      if (this.deps.hasActivePartnerRun(working.partnerId)) {
        console.log('[SCHEDULED-TASK] busy cancel:', working.partnerId)
        working = {
          ...working,
          busyCancelNoticeAt: now,
          updatedAt: now
        }
        await this.deps.taskStore.save({
          ...working,
          nextRunAt: computeNextRunAt(working, now)
        })
        this.deps.emitSessionListRefresh()
        return
      }
      const response = await this.deps.submitTask({
        partnerId: working.partnerId,
        input: working.prompt,
        mainModel: working.mainModel,
        preference: working.aiPreference,
        executionPermission: working.executionPermission
      })
      if (!response.success) {
        console.error('[SCHEDULED-TASK] submit failed:', response.error)
        await this.advanceNextRun(working, now)
        return
      }
      console.warn(
        '[SCHEDULED-TASK] fired:',
        JSON.stringify({ id: working.id, partnerId: working.partnerId, nextRunAt: working.nextRunAt, now })
      )
      working = {
        ...working,
        busyCancelNoticeAt: null,
        updatedAt: now
      }
      await this.advanceNextRun(working, now)
      this.deps.emitSessionListRefresh()
    } catch (error) {
      console.error('[SCHEDULED-TASK] fire failed:', error)
      await this.advanceNextRun(working, now)
    }
  }

  private async advanceNextRun(task: ScheduledTask, now: number): Promise<void> {
    await this.deps.taskStore.save({
      ...task,
      nextRunAt: computeNextRunAt(task, now),
      updatedAt: now
    })
  }
}

const normalizeWeekday = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 6) return null
  return number
}

export const SCHEDULED_TASK_PARTNER_BUSY_ERROR = PARTNER_BUSY_ERROR

import { v4 as uuidv4 } from 'uuid'
import type { ChatSubmitRequest, ChatSubmitResponse, PartnerUiStateV1, ScheduledTask, ScheduledTaskDismissBusyNoticeRequest, ScheduledTaskMutationResponse, ScheduledTaskRunNowRequest, ScheduledTaskSaveRequest, ScheduledTaskScheduleType, ScheduledTaskSetEnabledRequest } from '../../../shared/types'
import type { PartnerStore } from '../storage/domains/PartnerStore'
import type { ScheduledTaskStore } from '../storage/domains/ScheduledTaskStore'

const MISFIRE_GRACE_MS = 60_000
const PARTNER_BUSY_ERROR = '请等待当前任务结束，或先停止后再执行'
type TimerHandle = ReturnType<typeof setTimeout>
type ScheduledTaskServiceDeps = {
  taskStore: Pick<ScheduledTaskStore, 'list' | 'listEnabled' | 'listByPartner' | 'getById' | 'save' | 'delete'>
  partnerStore: Pick<PartnerStore, 'getPartner'>
  getPartnerUiState?: (partnerId: string) => Promise<PartnerUiStateV1 | null>
  hasActivePartnerRun: (partnerId: string) => boolean
  submitTask: (payload: ChatSubmitRequest) => Promise<ChatSubmitResponse>
  emitSessionListRefresh: () => void
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  now?: () => number
}

const parseTimeOfDay = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1]); const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}
const normalizeWeekday = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 6 ? number : null
}
const slotEpochForDate = (year: number, month: number, day: number, minutes: number): number => {
  const date = new Date(year, month, day); date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); return date.getTime()
}
const nextDailySlot = (after: number, minutes: number): number => {
  const current = new Date(after); const today = slotEpochForDate(current.getFullYear(), current.getMonth(), current.getDate(), minutes)
  return today > after ? today : slotEpochForDate(current.getFullYear(), current.getMonth(), current.getDate() + 1, minutes)
}
const nextWeeklySlot = (after: number, minutes: number, weekday: number): number => {
  const current = new Date(after); const daysUntil = (weekday - current.getDay() + 7) % 7
  const target = new Date(current.getFullYear(), current.getMonth(), current.getDate() + daysUntil)
  const slot = slotEpochForDate(target.getFullYear(), target.getMonth(), target.getDate(), minutes)
  return slot > after ? slot : slotEpochForDate(target.getFullYear(), target.getMonth(), target.getDate() + 7, minutes)
}
export const computeNextRunAt = (input: { scheduleType: ScheduledTaskScheduleType; timeOfDay: string; weekday: number | null }, after: number): number | null => {
  const minutes = parseTimeOfDay(input.timeOfDay); if (minutes === null) return null
  return input.scheduleType === 'weekly' ? (input.weekday === null || input.weekday < 0 || input.weekday > 6 ? null : nextWeeklySlot(after, minutes, input.weekday)) : nextDailySlot(after, minutes)
}

export class ScheduledTaskService {
  private readonly deps: Required<Pick<ScheduledTaskServiceDeps, 'setTimer' | 'clearTimer' | 'now'>> & Omit<ScheduledTaskServiceDeps, 'setTimer' | 'clearTimer' | 'now'>
  private timer: TimerHandle | null = null
  private running = false
  public constructor(deps: ScheduledTaskServiceDeps) { this.deps = { setTimer: (callback, delayMs) => setTimeout(callback, delayMs), clearTimer: (handle) => clearTimeout(handle), now: () => Date.now(), ...deps } }
  public async start(): Promise<void> { await this.reconcileMissed(); await this.scheduleNext() }
  public stop(): void { if (this.timer !== null) this.deps.clearTimer(this.timer); this.timer = null }
  public async list(): Promise<ScheduledTask[]> { return this.deps.taskStore.list() }
  public async listForPartner(partnerId: string): Promise<ScheduledTask[]> { return this.deps.taskStore.listByPartner(partnerId) }
  public async getForPartner(id: string, partnerId: string): Promise<ScheduledTask | null> { const task = await this.deps.taskStore.getById(id); return task?.partnerId === partnerId ? task : null }
  public async save(input: ScheduledTaskSaveRequest): Promise<ScheduledTaskMutationResponse> { try { const task = await this.buildTask(input); await this.deps.taskStore.save(task); await this.scheduleNext(); this.deps.emitSessionListRefresh(); return { success: true, task } } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } } }
  public async saveForPartner(partnerId: string, input: Omit<ScheduledTaskSaveRequest, 'partnerId'>): Promise<ScheduledTaskMutationResponse> { return this.save({ ...input, partnerId }) }
  public async delete(id: string): Promise<ScheduledTaskMutationResponse> { try { await this.deps.taskStore.delete(String(id || '').trim()); await this.scheduleNext(); return { success: true } } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } } }
  public async deleteForPartner(id: string, partnerId: string): Promise<ScheduledTaskMutationResponse> { const task = await this.deps.taskStore.getById(id); return task && task.partnerId === partnerId ? this.delete(id) : { success: false, error: '定时任务不存在' } }
  public async setEnabled(input: ScheduledTaskSetEnabledRequest): Promise<ScheduledTaskMutationResponse> { try { const existing = await this.deps.taskStore.getById(String(input.id || '').trim()); if (!existing) return { success: false, error: '定时任务不存在' }; if (input.enabled && (!existing.partnerId || !(await this.deps.partnerStore.getPartner(existing.partnerId)))) return { success: false, error: '请先选择有效伙伴' }; const now = this.deps.now(); const task = { ...existing, enabled: Boolean(input.enabled), nextRunAt: input.enabled ? computeNextRunAt(existing, now) : null, updatedAt: now }; await this.deps.taskStore.save(task); await this.scheduleNext(); return { success: true, task } } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } } }
  public async runNow(input: ScheduledTaskRunNowRequest): Promise<ScheduledTaskMutationResponse> { const task = await this.deps.taskStore.getById(String(input.id || '').trim()); return task ? this.execute(task, this.deps.now(), false) : { success: false, error: '定时任务不存在' } }
  public async dismissBusyNotice(input: ScheduledTaskDismissBusyNoticeRequest): Promise<ScheduledTaskMutationResponse> { const task = await this.deps.taskStore.getById(String(input.id || '').trim()); if (!task) return { success: false, error: '定时任务不存在' }; const updated = { ...task, busyCancelNoticeAt: null, updatedAt: this.deps.now() }; await this.deps.taskStore.save(updated); return { success: true, task: updated } }
  public async runDue(): Promise<void> { if (this.running) return; this.running = true; try { const now = this.deps.now(); for (const task of await this.deps.taskStore.listEnabled()) { if (task.nextRunAt === null || now < task.nextRunAt) continue; if (now - task.nextRunAt <= MISFIRE_GRACE_MS) await this.execute(task, now, true); else await this.advanceNextRun(task, now) } } finally { this.running = false; await this.scheduleNext() } }
  private async buildTask(input: ScheduledTaskSaveRequest): Promise<ScheduledTask> { const name = String(input.name || '').trim(); const description = String(input.description || '').trim(); const partnerId = String(input.partnerId || '').trim(); if (!partnerId || !(await this.deps.partnerStore.getPartner(partnerId))) throw new Error('请选择有效伙伴'); if (!name) throw new Error('请填写任务名称'); if (!description) throw new Error('请填写任务描述'); const scheduleType = input.scheduleType === 'weekly' ? 'weekly' : 'daily'; const timeOfDay = String(input.timeOfDay || '').trim(); if (parseTimeOfDay(timeOfDay) === null) throw new Error('执行时间格式不正确'); const weekday = scheduleType === 'weekly' ? normalizeWeekday(input.weekday) : null; if (scheduleType === 'weekly' && weekday === null) throw new Error('请选择星期几'); const now = this.deps.now(); const existing = input.id ? await this.deps.taskStore.getById(input.id) : null; if (input.id && !existing) throw new Error('定时任务不存在'); const enabled = existing?.enabled ?? true; return { id: existing?.id || uuidv4(), name, description, contentNodes: input.contentNodes || [], selectedReferences: input.selectedReferences || [], enabled, scheduleType, timeOfDay, weekday, partnerId, nextRunAt: enabled ? computeNextRunAt({ scheduleType, timeOfDay, weekday }, now) : null, busyCancelNoticeAt: existing?.busyCancelNoticeAt ?? null, createdAt: existing?.createdAt || now, updatedAt: now } }
  private async execute(task: ScheduledTask, now: number, advance: boolean): Promise<ScheduledTaskMutationResponse> { if (!task.partnerId) return { success: false, error: '定时任务未绑定伙伴' }; if (!(await this.deps.partnerStore.getPartner(task.partnerId))) { const stopped = { ...task, partnerId: '', enabled: false, nextRunAt: null, updatedAt: now }; await this.deps.taskStore.save(stopped); return { success: false, error: '绑定伙伴不存在，任务已停用' } } if (this.deps.hasActivePartnerRun(task.partnerId)) { if (advance) { await this.deps.taskStore.save({ ...task, busyCancelNoticeAt: now, nextRunAt: computeNextRunAt(task, now), updatedAt: now }); this.deps.emitSessionListRefresh() } return { success: false, error: PARTNER_BUSY_ERROR } } const state = await this.deps.getPartnerUiState?.(task.partnerId); const mainModel = state?.composer.modelSelection.mainModel; if (!state || !mainModel?.configId || !mainModel.modelName) return { success: false, error: '伙伴尚未选择主模型' }; const response = await this.deps.submitTask({ partnerId: task.partnerId, input: task.description, contentNodes: task.contentNodes, selectedReferences: task.selectedReferences, mainModel, preference: state.composer.aiPreference, executionPermission: state.composer.executionPermission }); if (!response.success) return { success: false, error: response.error || '执行失败' }; const updated = { ...task, busyCancelNoticeAt: null, nextRunAt: advance ? computeNextRunAt(task, now) : task.nextRunAt, updatedAt: now }; await this.deps.taskStore.save(updated); this.deps.emitSessionListRefresh(); return { success: true, task: updated } }
  private async reconcileMissed(): Promise<void> { const now = this.deps.now(); for (const task of await this.deps.taskStore.listEnabled()) if (task.nextRunAt !== null && task.nextRunAt <= now) await this.deps.taskStore.save({ ...task, nextRunAt: computeNextRunAt(task, now), updatedAt: now }) }
  private async advanceNextRun(task: ScheduledTask, now: number): Promise<void> { await this.deps.taskStore.save({ ...task, nextRunAt: computeNextRunAt(task, now), updatedAt: now }) }
  private async scheduleNext(): Promise<void> { if (this.timer !== null) this.deps.clearTimer(this.timer); this.timer = null; const next = (await this.deps.taskStore.listEnabled()).map((task) => task.nextRunAt).filter((value): value is number => value !== null).sort((a, b) => a - b)[0]; if (next !== undefined) this.timer = this.deps.setTimer(() => void this.runDue(), Math.max(0, next - this.deps.now())) }
}
export const SCHEDULED_TASK_PARTNER_BUSY_ERROR = PARTNER_BUSY_ERROR

import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

const scheduleFields = {
  name: z.string().min(1).describe('任务名称。'),
  description: z.string().min(1).describe('任务描述。'),
  scheduleType: z.enum(['daily', 'weekly']).describe('执行周期：daily 每天，weekly 每周。'),
  timeOfDay: z.string().min(1).describe('执行时间，格式 HH:mm。'),
  weekday: z.number().int().min(0).max(6).nullable().optional().describe('每周执行的星期，0 为周日，6 为周六。')
}

const scheduledTaskActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create').describe('创建任务。'),
    ...scheduleFields
  }),
  z.object({
    action: z.literal('update').describe('修改任务。'),
    id: z.string().min(1).describe('要修改的任务 ID。'),
    name: scheduleFields.name.optional(),
    description: scheduleFields.description.optional(),
    scheduleType: scheduleFields.scheduleType.optional(),
    timeOfDay: scheduleFields.timeOfDay.optional(),
    weekday: scheduleFields.weekday,
    enabled: z.boolean().optional().describe('是否启用任务；未提供时保持原状态。')
  }),
  z.object({
    action: z.literal('delete').describe('删除任务。'),
    id: z.string().min(1).describe('要删除的任务 ID。')
  })
])

const renderScheduledTaskResult = ({ data }: { data: unknown }): string => JSON.stringify(data)

export const SCHEDULED_TASK_LIST_SPEC: HumanToolSpec<
  Record<string, never>,
  'scheduled_task_list',
  'scheduled-tasks'
> = {
  name: 'scheduled_task_list',
  familyId: 'scheduled-tasks',
  skillIds: ['scheduled-tasks'],
  inputSchema: z.object({}),
  promptSpec: {
    name: 'scheduled_task_list',
    description: '读取当前伙伴的定时任务。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'scheduled-tasks'
  }),
  modelResult: { renderSuccess: renderScheduledTaskResult }
}

export const SCHEDULED_TASK_ACTION_SPEC: HumanToolSpec<
  z.infer<typeof scheduledTaskActionSchema>,
  'scheduled_task_action',
  'scheduled-tasks'
> = {
  name: 'scheduled_task_action',
  familyId: 'scheduled-tasks',
  skillIds: ['scheduled-tasks'],
  inputSchema: scheduledTaskActionSchema,
  promptSpec: {
    name: 'scheduled_task_action',
    description: '创建、修改或删除当前伙伴的定时任务。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'scheduled-tasks'
  }),
  modelResult: { renderSuccess: renderScheduledTaskResult }
}

export const SCHEDULED_TASK_TOOL_SPECS = [
  SCHEDULED_TASK_LIST_SPEC,
  SCHEDULED_TASK_ACTION_SPEC
] as const

export type ScheduledTaskActionInput = z.infer<typeof scheduledTaskActionSchema>

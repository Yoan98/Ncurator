import { z } from 'zod/v4'

export const SCHEDULED_TASK_LIST_SCHEMA = z.strictObject({})

const scheduledTaskCreateSchema = z
  .object({
    action: z.literal('create').describe('创建任务'),
    name: z.string().trim().min(1).describe('定时任务名称'),
    description: z.string().trim().min(1).describe('任务描述'),
    scheduleType: z.enum(['daily', 'weekly']).describe('执行周期，daily 表示每天，weekly 表示每周'),
    timeOfDay: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .describe('执行时间，格式 HH:mm'),
    weekday: z
      .number()
      .int()
      .min(0)
      .max(6)
      .nullable()
      .optional()
      .describe('每周执行的星期，0 为周日，6 为周六')
  })
  .strict()

const scheduledTaskUpdateSchema = z
  .object({
    action: z.literal('update').describe('修改任务'),
    id: z.string().trim().min(1).describe('定时任务 ID'),
    name: z.string().trim().min(1).optional().describe('定时任务名称'),
    description: z.string().trim().min(1).optional().describe('任务描述'),
    scheduleType: z
      .enum(['daily', 'weekly'])
      .optional()
      .describe('执行周期，daily 表示每天，weekly 表示每周'),
    timeOfDay: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
      .describe('执行时间，格式 HH:mm'),
    weekday: z
      .number()
      .int()
      .min(0)
      .max(6)
      .nullable()
      .optional()
      .describe('每周执行的星期，0 为周日，6 为周六'),
    enabled: z.boolean().optional().describe('是否启用任务')
  })
  .strict()

const scheduledTaskDeleteSchema = z
  .object({
    action: z.literal('delete').describe('删除任务'),
    id: z.string().trim().min(1).describe('定时任务 ID')
  })
  .strict()

export const SCHEDULED_TASK_ACTION_SCHEMA = z
  .discriminatedUnion('action', [
    scheduledTaskCreateSchema,
    scheduledTaskUpdateSchema,
    scheduledTaskDeleteSchema
  ])
  .superRefine((input, context) => {
    if (input.action === 'create') {
      if (input.scheduleType === 'weekly' && input.weekday == null) {
        context.addIssue({
          code: 'custom',
          path: ['weekday'],
          message: 'Weekly tasks require weekday'
        })
      }
      if (input.scheduleType === 'daily' && input.weekday != null) {
        context.addIssue({
          code: 'custom',
          path: ['weekday'],
          message: 'Daily tasks must not specify weekday'
        })
      }
      return
    }

    if (input.action === 'update') {
      const hasChange =
        input.name !== undefined ||
        input.description !== undefined ||
        input.scheduleType !== undefined ||
        input.timeOfDay !== undefined ||
        input.weekday !== undefined ||
        input.enabled !== undefined
      if (!hasChange) {
        context.addIssue({
          code: 'custom',
          message: 'Updating a task requires at least one field to change'
        })
      }
      if (input.scheduleType === 'daily' && input.weekday != null) {
        context.addIssue({
          code: 'custom',
          path: ['weekday'],
          message: 'weekday must be null when switching to a daily schedule'
        })
      }
    }
  })

export type ScheduledTaskListInput = z.infer<typeof SCHEDULED_TASK_LIST_SCHEMA>
export type ScheduledTaskActionInput = z.infer<typeof SCHEDULED_TASK_ACTION_SCHEMA>

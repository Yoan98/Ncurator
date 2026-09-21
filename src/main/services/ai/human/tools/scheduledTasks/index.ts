import { tool } from '@langchain/core/tools'
import type { ToolFamilyDefinition } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import {
  SCHEDULED_TASK_ACTION_SPEC,
  SCHEDULED_TASK_LIST_SPEC,
  type ScheduledTaskActionInput
} from './toolSpecs'

export const scheduledTasksToolFamily: ToolFamilyDefinition = {
  familyId: 'scheduled-tasks',
  buildTools: ({ ctx, runId, taskId }) => {
    const service = ctx.scheduledTaskService
    const emitter = createToolEventEmitter({ ctx, runId, taskId })

    const list = tool(
      async () =>
        await withToolLifecycle({
          emitter,
          toolName: SCHEDULED_TASK_LIST_SPEC.name,
          args: {},
          execute: async (session) => {
            if (!service) {
              const result = { error: '定时任务服务不可用' }
              session.fail(result.error)
              return result
            }
            const tasks = await service.listForPartner(ctx.partnerId)
            session.succeed()
            return tasks
          }
        }),
      {
        name: SCHEDULED_TASK_LIST_SPEC.name,
        description: SCHEDULED_TASK_LIST_SPEC.promptSpec.description,
        schema: SCHEDULED_TASK_LIST_SPEC.inputSchema
      }
    )

    const action = tool(
      async (args) =>
        await withToolLifecycle({
          emitter,
          toolName: SCHEDULED_TASK_ACTION_SPEC.name,
          args: args as Record<string, unknown>,
          execute: async (session) => {
            if (!service) {
              const result = { error: '定时任务服务不可用' }
              session.fail(result.error)
              return result
            }
            const input = args as ScheduledTaskActionInput
            if (input.action === 'create') {
              const result = await service.saveForPartner(ctx.partnerId, {
                name: input.name,
                description: input.description,
                scheduleType: input.scheduleType,
                timeOfDay: input.timeOfDay,
                weekday: input.weekday,
                contentNodes: [],
                selectedReferences: []
              })
              if (!result.success) {
                session.fail(result.error || '创建定时任务失败')
                return { error: result.error || '创建定时任务失败' }
              }
              session.succeed()
              return { id: result.task?.id }
            }
            const current = await service.getForPartner(input.id, ctx.partnerId)
            if (!current) {
              session.fail('定时任务不存在')
              return { error: '定时任务不存在' }
            }
            if (input.action === 'delete') {
              const result = await service.deleteForPartner(input.id, ctx.partnerId)
              if (!result.success) {
                session.fail(result.error || '删除定时任务失败')
                return { error: result.error || '删除定时任务失败' }
              }
              session.succeed()
              return { id: input.id }
            }
            const result = await service.saveForPartner(ctx.partnerId, {
              id: current.id,
              name: input.name ?? current.name,
              description: input.description ?? current.description,
              scheduleType: input.scheduleType ?? current.scheduleType,
              timeOfDay: input.timeOfDay ?? current.timeOfDay,
              weekday: input.weekday === undefined ? current.weekday : input.weekday,
              contentNodes: current.contentNodes,
              selectedReferences: current.selectedReferences
            })
            if (!result.success) {
              session.fail(result.error || '修改定时任务失败')
              return { error: result.error || '修改定时任务失败' }
            }
            if (input.enabled !== undefined) {
              const enabledResult = await service.setEnabled({ id: current.id, enabled: input.enabled })
              if (!enabledResult.success) {
                session.fail(enabledResult.error || '更新定时任务状态失败')
                return { error: enabledResult.error || '更新定时任务状态失败' }
              }
            }
            session.succeed()
            return { id: current.id }
          }
        }),
      {
        name: SCHEDULED_TASK_ACTION_SPEC.name,
        description: SCHEDULED_TASK_ACTION_SPEC.promptSpec.description,
        schema: SCHEDULED_TASK_ACTION_SPEC.inputSchema
      }
    )

    return [list, action]
  }
}

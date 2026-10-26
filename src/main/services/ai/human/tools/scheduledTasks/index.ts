import { tool } from '@langchain/core/tools'
import type { AiToolCallResult, JsonValue } from '../../../../../../shared/types'
import type { ToolFamilyDefinition } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import {
  SCHEDULED_TASK_ACTION_SPEC,
  SCHEDULED_TASK_LIST_SPEC,
  type ScheduledTaskActionInput
} from './toolSpecs'
import type { ScheduledTaskListItemOutput } from './outputTypes'

const toListItem = (task: {
  id: string
  name: string
  description: string
  scheduleType: 'daily' | 'weekly'
  timeOfDay: string
  weekday: number | null
  enabled: boolean
}): ScheduledTaskListItemOutput => ({
  id: task.id,
  name: task.name,
  description: task.description,
  scheduleType: task.scheduleType,
  timeOfDay: task.timeOfDay,
  weekday: task.weekday,
  enabled: task.enabled
})

const buildToolResult = (input: {
  toolName: string
  ok: boolean
  data: JsonValue
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data
})

const toJsonValue = (value: object): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const successResult = (toolName: string, data: object): AiToolCallResult =>
  buildToolResult({ toolName, ok: true, data: toJsonValue(data) })

const failureResult = (toolName: string, error: string): AiToolCallResult =>
  buildToolResult({ toolName, ok: false, data: { error } })

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
              const result = { error: 'The scheduled task service is unavailable' }
              session.fail(
                result.error,
                undefined,
                failureResult(SCHEDULED_TASK_LIST_SPEC.name, result.error)
              )
              return result
            }
            const tasks = (await service.listForPartner(ctx.partnerId)).map(toListItem)
            const payload = { tasks }
            session.succeed(undefined, successResult(SCHEDULED_TASK_LIST_SPEC.name, payload))
            return payload
          },
          onError: (error, session) => {
            session.fail(
              error.message,
              undefined,
              failureResult(SCHEDULED_TASK_LIST_SPEC.name, error.message)
            )
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
              const result = { error: 'The scheduled task service is unavailable' }
              session.fail(
                result.error,
                undefined,
                failureResult(SCHEDULED_TASK_ACTION_SPEC.name, result.error)
              )
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
                contentNodes: [{ kind: 'text', text: input.description }],
                selectedReferences: []
              })
              if (!result.success) {
                const error = result.error || 'Failed to create the scheduled task'
                session.fail(
                  error,
                  undefined,
                  failureResult(SCHEDULED_TASK_ACTION_SPEC.name, error)
                )
                return { error }
              }
              const payload = { id: result.task?.id || '' }
              session.succeed(undefined, successResult(SCHEDULED_TASK_ACTION_SPEC.name, payload))
              return payload
            }
            const current = await service.getForPartner(input.id, ctx.partnerId)
            if (!current) {
              const error = 'The scheduled task was not found'
              session.fail(error, undefined, failureResult(SCHEDULED_TASK_ACTION_SPEC.name, error))
              return { error }
            }
            if (input.action === 'delete') {
              const result = await service.deleteForPartner(input.id, ctx.partnerId)
              if (!result.success) {
                const error = result.error || 'Failed to delete the scheduled task'
                session.fail(
                  error,
                  undefined,
                  failureResult(SCHEDULED_TASK_ACTION_SPEC.name, error)
                )
                return { error }
              }
              const payload = { id: input.id }
              session.succeed(undefined, successResult(SCHEDULED_TASK_ACTION_SPEC.name, payload))
              return payload
            }
            const result = await service.saveForPartner(ctx.partnerId, {
              id: current.id,
              name: input.name ?? current.name,
              description: input.description ?? current.description,
              scheduleType: input.scheduleType ?? current.scheduleType,
              timeOfDay: input.timeOfDay ?? current.timeOfDay,
              weekday: input.weekday === undefined ? current.weekday : input.weekday,
              contentNodes:
                input.description === undefined
                  ? current.contentNodes
                  : [{ kind: 'text', text: input.description }],
              selectedReferences: input.description === undefined ? current.selectedReferences : [],
              enabled: input.enabled
            })
            if (!result.success) {
              const error = result.error || 'Failed to update the scheduled task'
              session.fail(error, undefined, failureResult(SCHEDULED_TASK_ACTION_SPEC.name, error))
              return { error }
            }
            const payload = { id: current.id }
            session.succeed(undefined, successResult(SCHEDULED_TASK_ACTION_SPEC.name, payload))
            return payload
          },
          onError: (error, session) => {
            session.fail(
              error.message,
              undefined,
              failureResult(SCHEDULED_TASK_ACTION_SPEC.name, error.message)
            )
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

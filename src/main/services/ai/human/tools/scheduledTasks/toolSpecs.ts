import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderScheduledTaskListModelResult,
  renderScheduledTaskModelError,
  renderScheduledTaskMutationModelResult
} from '../../shared/modelToolResultRenderers'
import {
  SCHEDULED_TASK_ACTION_SCHEMA,
  SCHEDULED_TASK_LIST_SCHEMA,
  type ScheduledTaskActionInput,
  type ScheduledTaskListInput
} from './toolSchemas'

export const SCHEDULED_TASK_LIST_SPEC: HumanToolSpec<
  ScheduledTaskListInput,
  'scheduled_task_list',
  'scheduled-tasks'
> = {
  name: 'scheduled_task_list',
  familyId: 'scheduled-tasks',
  toolsetIds: ['scheduled-tasks'],
  inputSchema: SCHEDULED_TASK_LIST_SCHEMA,
  promptSpec: {
    name: 'scheduled_task_list',
    description: '读取当前伙伴的定时任务。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'scheduled-tasks'
  }),
  modelResult: {
    renderSuccess: renderScheduledTaskListModelResult,
    renderError: renderScheduledTaskModelError
  }
}

export const SCHEDULED_TASK_ACTION_SPEC: HumanToolSpec<
  ScheduledTaskActionInput,
  'scheduled_task_action',
  'scheduled-tasks'
> = {
  name: 'scheduled_task_action',
  familyId: 'scheduled-tasks',
  toolsetIds: ['scheduled-tasks'],
  inputSchema: SCHEDULED_TASK_ACTION_SCHEMA,
  promptSpec: {
    name: 'scheduled_task_action',
    description: '创建、修改或删除当前伙伴的定时任务。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'scheduled-tasks'
  }),
  modelResult: {
    renderSuccess: renderScheduledTaskMutationModelResult,
    renderError: renderScheduledTaskModelError
  }
}

export const SCHEDULED_TASK_TOOL_SPECS = [
  SCHEDULED_TASK_LIST_SPEC,
  SCHEDULED_TASK_ACTION_SPEC
] as const

export type { ScheduledTaskActionInput } from './toolSchemas'

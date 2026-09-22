import { describe, it } from 'vitest'
import { ScheduledTaskService } from '../../../../../src/main/services/scheduler/ScheduledTaskService'
import type { Partner } from '../../../../../src/shared/types'
import { createScheduledTaskToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const partner = (id: string, name: string): Partner => ({
  id,
  name,
  avatar_shape: 'circle',
  avatar_color: 'blue',
  created_at: Date.now(),
  updated_at: Date.now(),
  last_viewed_at: Date.now(),
  pinned: false,
  pinned_at: null
})

describe('ai tool scheduled-task backend', () => {
  it('scheduled-task-read-write-and-partner-boundary', async () => {
    await runBackendCase({
      caseId: 'scheduled-task-read-write-and-partner-boundary',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['scheduled-task'],
      description: '验证定时任务工具的最小返回、默认启用、生命周期结果一致和伙伴隔离。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.partnerStore.savePartner(partner('partner-a', '伙伴 A'))
        await runtime.partnerStore.savePartner(partner('partner-b', '伙伴 B'))
        const service = new ScheduledTaskService({
          taskStore: runtime.storageService.scheduledTask,
          partnerStore: runtime.partnerStore,
          hasActivePartnerRun: () => false,
          submitTask: async () => ({ success: true, runId: 'unused' }),
          emitSessionListRefresh: () => undefined
        })
        const harnessA = createScheduledTaskToolHarness(runtime, {
          partnerId: 'partner-a',
          scheduledTaskService: service
        })
        const harnessB = createScheduledTaskToolHarness(runtime, {
          partnerId: 'partner-b',
          scheduledTaskService: service
        })

        const created = await harnessA.invoke<{ id: string }>('scheduled_task_action', {
          action: 'create',
          name: '每日晨报',
          description: '整理当天的重要事项',
          scheduleType: 'daily',
          timeOfDay: '09:00'
        })
        const listA = await harnessA.invoke<{
          tasks: Array<Record<string, string | number | boolean | null>>
        }>('scheduled_task_list', {})
        const listB = await harnessB.invoke<{ tasks: unknown[] }>('scheduled_task_list', {})
        const crossPartnerUpdate = await harnessB.invoke<{ error?: string }>(
          'scheduled_task_action',
          { action: 'update', id: created.id, timeOfDay: '10:00' }
        )
        const updated = await harnessA.invoke<{ id: string }>('scheduled_task_action', {
          action: 'update',
          id: created.id,
          timeOfDay: '10:00',
          enabled: false
        })
        const stored = await runtime.storageService.scheduledTask.getById(created.id)
        const deleted = await harnessA.invoke<{ id: string }>('scheduled_task_action', {
          action: 'delete',
          id: created.id
        })
        const listAfterDelete = await harnessA.invoke<{ tasks: unknown[] }>(
          'scheduled_task_list',
          {}
        )
        const resultEvents = runtime.eventCollector
          .snapshot()
          .filter((event) => event.type === 'tool_call_result')
        service.stop()

        return {
          created,
          listA,
          listB,
          crossPartnerUpdate,
          updated,
          stored,
          deleted,
          listAfterDelete,
          resultEvents
        }
      },
      assert: async (result, runtime) => {
        const item = result.listA.tasks[0]
        const expectedKeys = [
          'description',
          'enabled',
          'id',
          'name',
          'scheduleType',
          'timeOfDay',
          'weekday'
        ]
        runtime.assertThat(
          result.listA.tasks.length === 1 &&
            result.listB.tasks.length === 0 &&
            item?.enabled === true &&
            JSON.stringify(Object.keys(item || {}).sort()) === JSON.stringify(expectedKeys) &&
            result.crossPartnerUpdate.error === '定时任务不存在' &&
            result.updated.id === result.created.id &&
            result.stored?.timeOfDay === '10:00' &&
            result.stored.enabled === false &&
            result.deleted.id === result.created.id &&
            result.listAfterDelete.tasks.length === 0,
          {
            name: 'scheduled-task-tool-contract',
            message: '工具应只返回当前伙伴的最小任务字段，并原子更新配置和启用状态。',
            data: result
          }
        )
        const successfulListEvent = result.resultEvents.find(
          (event) => event.toolName === 'scheduled_task_list' && event.result?.ok
        )
        runtime.assertThat(
          JSON.stringify(successfulListEvent?.result?.data) === JSON.stringify(result.listA),
          {
            name: 'scheduled-task-lifecycle-result-matches-runtime-result',
            message: '生命周期事件和工具结构化返回必须完全一致。',
            data: { event: successfulListEvent?.result?.data, runtime: result.listA }
          }
        )
      }
    })
  })
})

import { describe, it } from 'vitest'
import { ScheduledTaskService } from '../../../../../src/main/services/scheduler/ScheduledTaskService'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { collectStartedToolInputs, filterAiRunEventsByType } from '../testUtils'

const PARTNER_ID = 'live-scheduled-task-partner'

describe('ai human live scheduled task', () => {
  it('human-scheduled-task-lifecycle-live', async () => {
    await runBackendCase({
      caseId: 'human-scheduled-task-lifecycle-live',
      harnessMode: 'live',
      domain: 'ai',
      suite: 'human',
      groups: ['live', 'scheduled-task'],
      description:
        '验证真实模型在多个 run 中学习定时任务技能并完成创建、读取、修改、删除生命周期。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
      execute: async (runtime) => {
        await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
        await runtime.partnerStore.savePartner({
          id: PARTNER_ID,
          name: '定时任务 Live 伙伴',
          avatar_shape: 'circle',
          avatar_color: 'blue',
          created_at: Date.now(),
          updated_at: Date.now(),
          last_viewed_at: Date.now(),
          pinned: false,
          pinned_at: null
        })
        const service = new ScheduledTaskService({
          taskStore: runtime.storageService.scheduledTask,
          partnerStore: runtime.partnerStore,
          hasActivePartnerRun: () => false,
          submitTask: async () => ({ success: true, runId: 'unused' }),
          emitSessionListRefresh: () => undefined
        })

        const run1 = await createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          scheduledTaskService: service
        }).run({
          taskId: `${runtime.taskId}-create`,
          userInput:
            '请为当前伙伴创建一个每天上午 9 点运行的「每日晨报」定时任务，任务描述是「整理当天的重要事项」。创建后请读取当前定时任务确认结果。'
        })
        const run1Events = runtime.eventCollector.snapshot()
        const created = (await runtime.storageService.scheduledTask.listByPartner(PARTNER_ID))[0]
        const createdEnabled = created?.enabled === true

        const run2 = await createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          scheduledTaskService: service
        }).run({
          taskId: `${runtime.taskId}-update`,
          userInput:
            '把刚才的「每日晨报」改到每天 10 点，任务描述改为「整理当天的重要事项并标记风险」，并关闭它。修改后请再次读取当前定时任务确认结果。'
        })
        const allEvents = runtime.eventCollector.snapshot()
        const run2Events = allEvents.slice(run1Events.length)
        const updated = created
          ? await runtime.storageService.scheduledTask.getById(created.id)
          : null

        const run3 = await createHumanTestRunner(runtime, {
          partnerId: PARTNER_ID,
          scheduledTaskService: service
        }).run({
          taskId: `${runtime.taskId}-delete`,
          userInput: '请删除刚才的「每日晨报」定时任务，然后读取当前伙伴的定时任务确认它已经删除。'
        })
        const finalEvents = runtime.eventCollector.snapshot()
        const run3Events = finalEvents.slice(allEvents.length)
        const remainingTasks = await runtime.storageService.scheduledTask.listByPartner(PARTNER_ID)
        service.stop()
        return {
          run1,
          run2,
          run3,
          run1Events,
          run2Events,
          run3Events,
          createdEnabled,
          created,
          updated,
          remainingTasks
        }
      },
      assert: async (result, runtime) => {
        const run1Names = filterAiRunEventsByType(result.run1Events, 'tool_call_started').map(
          (event) => event.toolName
        )
        const run1Actions = collectStartedToolInputs(result.run1Events, 'scheduled_task_action')
        const run2Actions = collectStartedToolInputs(result.run2Events, 'scheduled_task_action')
        const run2Names = filterAiRunEventsByType(result.run2Events, 'tool_call_started').map(
          (event) => event.toolName
        )
        const run3Actions = collectStartedToolInputs(result.run3Events, 'scheduled_task_action')
        const run3Names = filterAiRunEventsByType(result.run3Events, 'tool_call_started').map(
          (event) => event.toolName
        )
        runtime.assertThat(
          result.run1.status === 'completed' &&
            result.run2.status === 'completed' &&
            result.run3.status === 'completed' &&
            run1Names.includes('learn_skill') &&
            run1Names.includes('scheduled_task_action') &&
            run1Names.includes('scheduled_task_list') &&
            run1Actions.some((input) => input.action === 'create') &&
            result.createdEnabled &&
            run2Names.includes('scheduled_task_action') &&
            run2Names.includes('scheduled_task_list') &&
            run2Actions.some((input) => input.action === 'update' && input.enabled === false) &&
            result.updated?.partnerId === PARTNER_ID &&
            result.updated.timeOfDay === '10:00' &&
            result.updated.enabled === false &&
            run3Names.includes('scheduled_task_action') &&
            run3Names.includes('scheduled_task_list') &&
            run3Actions.some((input) => input.action === 'delete') &&
            result.remainingTasks.length === 0,
          {
            name: 'human-scheduled-task-lifecycle-live',
            message: '真实模型应跨多个 run 学习技能并完成当前伙伴任务的创建、读取、修改和删除。',
            data: {
              run1Names,
              run2Names,
              run3Names,
              run1Actions,
              run2Actions,
              run3Actions,
              created: result.created,
              updated: result.updated,
              remainingTasks: result.remainingTasks,
              deliveries: [
                result.run1.deliveryMarkdown,
                result.run2.deliveryMarkdown,
                result.run3.deliveryMarkdown
              ]
            }
          }
        )
      }
    })
  })
})

import { describe, it } from 'vitest'
import { ScheduledTaskService } from '../../../../../src/main/services/scheduler/ScheduledTaskService'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLoadToolsetsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm scheduled task', () => {
  it('scheduled-task-learn-create-read-update-read', async () => {
    await runBackendCase({
      caseId: 'scheduled-task-learn-create-read-update-read',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm', 'scheduled-task'],
      description: '验证模型先学习定时任务技能，再创建、读取、修改并复读确认。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const partnerId = 'scheduled-task-mock-partner'
        await runtime.partnerStore.savePartner({
          id: partnerId,
          name: '定时任务测试伙伴',
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
        const runner = createHumanTestRunner(runtime, {
          partnerId,
          scheduledTaskService: service,
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetIds: ['scheduled-tasks'],
                  summary: '学习定时任务能力'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'scheduled_task_action',
                  args: {
                    action: 'create',
                    name: '每日晨报',
                    description: '整理当天的重要事项',
                    scheduleType: 'daily',
                    timeOfDay: '09:00'
                  },
                  summary: '创建晨报任务'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'scheduled_task_list',
                  args: {},
                  summary: '读取任务确认创建结果'
                })
              },
              async () => {
                const task = (
                  await runtime.storageService.scheduledTask.listByPartner(partnerId)
                )[0]
                return buildToolDecision({
                  toolName: 'scheduled_task_action',
                  // Models may encode booleans as strings; the shared brain repair should fix it.
                  args: { action: 'update', id: task.id, timeOfDay: '10:00', enabled: 'false' },
                  summary: '修改并停用晨报任务'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'scheduled_task_list',
                  args: {},
                  summary: '复读确认修改结果'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '定时任务已完成配置。',
                  deliveryMarkdown: '定时任务已改为每天 10:00，并已停用。'
                })
              }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '创建每天九点的晨报任务，然后改成十点并关闭。'
        })
        const tasks = await runtime.storageService.scheduledTask.listByPartner(partnerId)
        const events = runtime.eventCollector.snapshot()
        const schemaFeedback = events.filter(
          (event) =>
            event.type === 'tool_call_result' &&
            event.toolName === 'scheduled_task_action' &&
            event.result?.ok === false &&
            JSON.stringify(event.result.data || '').includes('arguments do not match the schema')
        )
        service.stop()
        return { output, tasks, events, schemaFeedback }
      },
      assert: async (result, runtime) => {
        const started = filterAiRunEventsByType(result.events, 'tool_call_started').map(
          (event) => event.toolName
        )
        const task = result.tasks[0]
        runtime.assertThat(
          result.output.status === 'completed' &&
            started.includes('load_toolset') &&
            started.filter((name) => name === 'scheduled_task_action').length === 2 &&
            started.filter((name) => name === 'scheduled_task_list').length === 2 &&
            task?.partnerId === 'scheduled-task-mock-partner' &&
            task.timeOfDay === '10:00' &&
            task.enabled === false &&
            result.schemaFeedback.length === 0,
          {
            name: 'scheduled-task-human-flow',
            message: '模型应学习技能后在当前伙伴内创建、复读、修改并再次复读。',
            data: { started, tasks: result.tasks, output: result.output }
          }
        )
      }
    })
  })
})

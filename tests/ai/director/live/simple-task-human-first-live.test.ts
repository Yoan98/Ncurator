import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createHumanLiveKbFixture,
  createRateLimitedLiveChatStructuredOverride,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_PRIMARY_MODEL,
  KB_TOOL_NAMES
} from '../../human/live/testUtils'
import { filterDirectorEventsByType, summarizeDirectorEvents } from '../testUtils'

const liveIt = HUMAN_LIVE_PRIMARY_MODEL ? it : it.skip

describe('ai director live backend', () => {
  liveIt('simple-task-human-first-live', async () => {
    await runBackendCase({
      caseId: 'simple-task-human-first-live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证普通任务在真实 AI 调用下仍走 direct human，不进入 context 或 plan。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: HUMAN_LIVE_PRIMARY_MODEL?.model_name ?? null,
      execute: async (runtime) => {
        const kbFixture = createHumanLiveKbFixture()
        const runner = createDirectorTestRunner(runtime, {
          bindWorkspace: false,
          chatStructuredOverride: HUMAN_LIVE_PRIMARY_MODEL
            ? createRateLimitedLiveChatStructuredOverride(HUMAN_LIVE_PRIMARY_MODEL, 15_000)
            : undefined,
          selectedDocumentIds: kbFixture.selectedDocumentIds,
          documentsStoreOverrides: kbFixture.storeOverrides
        })

        const output = await runner.run({
          userInput: [
            '请只基于当前已选本地资料直接回答一个简单问题：本周风险总结是什么？',
            '先确认当前资料范围，再检索证据，然后给出简明最终答复。',
            '不要修改任何文件，不要拆成多阶段计划，也不要编造资料外的事实。'
          ].join('\n')
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const directorTaskStarted = filterDirectorEventsByType(result.events, 'task_started')
        const directorTaskCompleted = filterDirectorEventsByType(result.events, 'task_completed')
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const kbToolResults = filterToolCallResultEventsByNames(result.events, KB_TOOL_NAMES)
        const kbPreviewText = kbToolResults.map((event) => JSON.stringify(event.outputPreview)).join('\n')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.directorStage === 'director_complete' &&
            result.output.plan.length === 0 &&
            planCreatedEvents.length === 0 &&
            directorTaskStarted.length === 1 &&
            directorTaskStarted[0]?.taskId === 'direct-human' &&
            directorTaskStarted[0]?.stage === 'director_direct_human_exec' &&
            directorTaskCompleted.length === 1 &&
            directorTaskCompleted[0]?.taskId === 'direct-human',
          {
            name: 'director-live-simple-task-stays-human-first',
            message:
              'simple-task-human-first-live 应保持 direct human 默认路径，不进入 context 或 plan/synthesis 链路。',
            data: {
              directorEvents: summarizeDirectorEvents(result.events),
              planLength: result.output.plan.length,
              finalDeliveryMarkdown: result.output.finalDeliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          kbToolResults.length >= 1 &&
            result.output.finalDeliveryMarkdown?.trim().length !== 0 &&
            kbPreviewText.includes('Risk Playbook.md') &&
            !kbPreviewText.includes('Out of Scope Notes.md'),
          {
            name: 'director-live-simple-task-uses-scoped-kb-without-expansion',
            message:
              'simple-task-human-first-live 应由 direct human 基于当前已选资料完成单任务问答，且不能越出资料范围。',
            data: {
              kbToolNames: kbToolResults.map((event) => event.toolName),
              kbPreviewText
            }
          }
        )
      }
    })
  }, 300_000)
})

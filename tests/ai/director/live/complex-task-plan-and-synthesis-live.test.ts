import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  areAllPathsAccessible,
  createHumanLiveKbFixture,
  createRateLimitedLiveChatStructuredOverride,
  DOCX_DELIVERY_TOOL_NAMES,
  DOCX_READ_TOOL_NAMES,
  DOCX_WRITE_TOOL_NAMES,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_STRONG_MODEL,
  isDocxPreviewArtifact,
  KB_TOOL_NAMES
} from '../../human/live/testUtils'
import { filterDirectorEventsByType, summarizeDirectorEvents } from '../testUtils'

const liveIt = HUMAN_LIVE_STRONG_MODEL ? it : it.skip

describe('ai director live backend', () => {
  liveIt('complex-task-plan-and-synthesis-live', async () => {
    await runBackendCase({
      caseId: 'complex-task-plan-and-synthesis-live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description:
        '验证复杂任务在真实 AI 调用下进入增强路径，完成 plan task 执行并由 synthesis 汇总交付。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: HUMAN_LIVE_STRONG_MODEL?.model_name ?? null,
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'director-plan-live.docx', [
          {
            type: 'heading',
            text: 'Weekly Review Pack',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Weekly risk summary: RISK_TODO'
          },
          {
            type: 'paragraph',
            text: 'Owner note: OWNER_TODO'
          }
        ])

        const kbFixture = createHumanLiveKbFixture()
        const runner = createDirectorTestRunner(runtime, {
          chatStructuredOverride: HUMAN_LIVE_STRONG_MODEL
            ? createRateLimitedLiveChatStructuredOverride(HUMAN_LIVE_STRONG_MODEL, 16_000)
            : undefined,
          selectedDocumentIds: kbFixture.selectedDocumentIds,
          documentsStoreOverrides: kbFixture.storeOverrides
        })

        const output = await runner.run({
          userInput: [
            '请完成一个复杂多步骤任务：',
            '1. 先只从当前已选资料里提取与本周风险总结、负责人说明相关的规则和事实。',
            '2. 再打开当前工作区的 `director-plan-live.docx`，把 `RISK_TODO` 和 `OWNER_TODO` 分别替换成你从资料里得到的内容。',
            '3. 然后生成 html preview，但不要覆盖保存源文件。',
            '4. 最后基于前面各阶段结果给我综合交付说明。',
            '5. 不要跳步，不要只给最终答案而忽略前面的本地动作，也不要编造资料外事实。'
          ].join('\n')
        })

        const previewArtifacts = (output.finalArtifacts || []).filter(isDocxPreviewArtifact)
        const previewPaths = previewArtifacts.map((artifact) => artifact.path)

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          previewArtifacts,
          previewPathsExist: await areAllPathsAccessible(previewPaths)
        }
      },
      assert: async (result, runtime) => {
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const taskStartedEvents = filterDirectorEventsByType(result.events, 'task_started')
        const taskCompletedEvents = filterDirectorEventsByType(result.events, 'task_completed')
        const kbToolResults = filterToolCallResultEventsByNames(result.events, KB_TOOL_NAMES)
        const docxReadResults = filterToolCallResultEventsByNames(result.events, DOCX_READ_TOOL_NAMES)
        const docxWriteResults = filterToolCallResultEventsByNames(result.events, DOCX_WRITE_TOOL_NAMES)
        const docxDeliveryResults = filterToolCallResultEventsByNames(
          result.events,
          DOCX_DELIVERY_TOOL_NAMES
        )
        const startedTaskIds = taskStartedEvents.map((event) => event.taskId)
        const hasDirectHuman = taskStartedEvents.some(
          (event) => event.stage === 'director_direct_human_exec'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.directorStage === 'director_complete' &&
            !hasDirectHuman &&
            planCreatedEvents.length === 1 &&
            planCreatedEvents[0]!.plan.length >= 2 &&
            startedTaskIds.includes('synthesis-human') &&
            startedTaskIds.filter((taskId) => taskId !== 'synthesis-human').length >= 2 &&
            taskCompletedEvents.length === taskStartedEvents.length,
          {
            name: 'director-live-complex-task-enters-enhanced-path',
            message:
              'complex-task-plan-and-synthesis-live 应进入 plan/synthesis 增强路径，不应退回 direct human，并且要产生多条可执行 task。',
            data: {
              directorEvents: summarizeDirectorEvents(result.events),
              plan: planCreatedEvents[0]?.plan
            }
          }
        )

        runtime.assertThat(
          kbToolResults.length >= 1 &&
            docxReadResults.some((event) => event.toolName === 'docx_open') &&
            docxWriteResults.some((event) => event.toolName === 'docx_apply_ops') &&
            docxDeliveryResults.some((event) => event.toolName === 'docx_render_preview') &&
            result.output.plan.every((task) => task.status === 'completed') &&
            result.previewArtifacts.length >= 1 &&
            result.previewPathsExist &&
            result.output.finalDeliveryMarkdown?.trim().length !== 0,
          {
            name: 'director-live-complex-task-merges-real-task-results-and-artifacts',
            message:
              'complex-task-plan-and-synthesis-live 应真实完成 KB + docx 多类任务，并把 plan 阶段 preview artifact 合并到最终交付。',
            data: {
              taskStatuses: result.output.plan.map((task) => ({
                id: task.id,
                status: task.status
              })),
              finalArtifacts: result.output.finalArtifacts,
              toolNames: [
                ...kbToolResults.map((event) => event.toolName),
                ...docxReadResults.map((event) => event.toolName),
                ...docxWriteResults.map((event) => event.toolName),
                ...docxDeliveryResults.map((event) => event.toolName)
              ]
            }
          }
        )
      }
    })
  }, 420_000)
})

import { test } from 'vitest'
import { buildDirectorGraph } from '../../../../../src/main/services/ai/director/graph/directorGraph'
import type {
  AiArtifactRef,
  AiPlanTask,
  AiRunEvent
} from '../../../../../src/shared/types'
import type { AiRunState, HumanTaskOutput, HumanTaskRunner } from '../../../../../src/main/services/ai/types'
import { createInitialAiRunState } from '../../../../../src/main/services/ai/utils/state'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const buildInitialState = (runtime: {
  runId: string
}): AiRunState =>
  createInitialAiRunState({
    runId: runtime.runId,
    sessionId: 'test-session',
    input: '整理项目材料并输出最终结论'
  })

const buildArtifact = (path: string, summary: string): AiArtifactRef => ({
  kind: 'file',
  capability: 'docx',
  path,
  fileName: path.split('/').at(-1) || 'artifact.docx',
  operation: 'created',
  summary
})

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

test('director-human-dispatch', async () => {
  await runBackendCase({
    caseId: 'director-human-dispatch',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'entire',
    groups: ['basic'],
    description: 'director direct, plan-exec, and synthesis human dispatch keep lifecycle events and artifact merging after shared dispatch extraction.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const directCalls: string[] = []
      const directRunHumanTask: HumanTaskRunner = async (taskInput): Promise<HumanTaskOutput> => {
        directCalls.push(taskInput.taskId)
        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '直接完成任务。',
          deliveryMarkdown: '# 最终答复\n\n直接执行完成。',
          artifacts: [buildArtifact('/tmp/direct-output.docx', 'direct artifact')]
        }
      }
      const directCtx = runtime.createAiRunContext({
        chatStructuredOverride: async (input) => {
          if (input.caller === 'director.intent') {
            return {
              mode: 'direct_human'
            }
          }
          throw new Error(`unexpected structured call: ${input.caller}`)
        }
      })
      const directGraph = buildDirectorGraph({
        ctx: directCtx,
        runHumanTask: directRunHumanTask
      })
      const directState = (await directGraph.invoke(buildInitialState(runtime))) as AiRunState
      const directEvents = runtime.eventCollector.snapshot()

      const contextCalls: string[] = []
      const contextRunHumanTask: HumanTaskRunner = async (taskInput): Promise<HumanTaskOutput> => {
        contextCalls.push(taskInput.taskId)
        if (taskInput.taskId === 'context-1') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '当前缺少上一轮指代所需的上下文，已整理可继续执行的边界。',
            deliveryMarkdown:
              '# 上下文补充结果\n\n## 本轮结论\n当前材料不足以补齐上一轮指代。\n\n## 可复用证据\n无\n\n## 当前边界\n- 暂无足够上下文可直接复用。\n- 可按当前输入继续常规计划执行。\n\n## 未决项\n- 上一轮指代缺少更具体材料。\n\n## 建议补充方向\n- 如无更多材料，直接进入常规计划执行。'
          }
        }
        if (taskInput.taskId === 'task-after-context') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '上下文回退后已完成计划子任务。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 本任务结论\n已在缺少上下文时回退到常规计划执行。\n\n## 已完成\n- 已整理可继续执行的事实。\n\n## 关键事实\n- 当前输入可直接进入后续汇总。\n\n## 关键证据\n- context fallback 后未污染 evidence。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n- synthesis 可继续输出。\n\n## 建议下一步\n- 汇总结果。',
            artifacts: [buildArtifact('/tmp/context-plan-output.docx', 'context fallback artifact')]
          }
        }
        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '上下文回退后的最终汇总完成。',
          deliveryMarkdown: '# 最终答复\n\ncontext fallback 后已正常进入 plan 并完成汇总。',
          artifacts: [buildArtifact('/tmp/context-synthesis-output.docx', 'context synthesis artifact')]
        }
      }
      const contextCtx = runtime.createAiRunContext({
        chatStructuredOverride: async (input) => {
          if (input.caller === 'director.intent') {
            return {
              mode: 'need_context',
              reason: '当前输入缺少明确指代，需要先尝试补齐上下文。'
            }
          }
          if (input.caller === 'director.plan') {
            return {
              tasks: [
                {
                  id: 'task-after-context',
                  title: '上下文回退后继续整理',
                  userInput: '在 context 无法补齐时，按当前输入整理可继续执行的事实'
                }
              ] satisfies AiPlanTask[]
            }
          }
          throw new Error(`unexpected structured call: ${input.caller}`)
        }
      })
      const contextGraph = buildDirectorGraph({
        ctx: contextCtx,
        runHumanTask: contextRunHumanTask,
        maxContextRounds: 1
      })
      const contextState = (await contextGraph.invoke(buildInitialState(runtime))) as AiRunState
      const contextEvents = runtime.eventCollector.snapshot()

      const planCalls: string[] = []
      const planRunHumanTask: HumanTaskRunner = async (taskInput): Promise<HumanTaskOutput> => {
        planCalls.push(taskInput.taskId)
        if (taskInput.taskId === 'task-collect') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '子任务完成。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 本任务结论\n已完成事实收集。\n\n## 已完成\n- 已完成关键核对。\n\n## 关键事实\n- 已整理事实。\n\n## 关键证据\n- 已找到证据。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n- synthesis 可直接汇总。\n\n## 建议下一步\n- 继续汇总输出。',
            artifacts: [buildArtifact('/tmp/task-output.docx', 'task artifact')]
          }
        }

        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '汇总完成。',
          deliveryMarkdown: '# 最终答复\n\n汇总交付完成。',
          artifacts: [buildArtifact('/tmp/synthesis-output.docx', 'synthesis artifact')]
        }
      }
      const planCtx = runtime.createAiRunContext({
        chatStructuredOverride: async (input) => {
          if (input.caller === 'director.intent') {
            return {
              mode: 'to_plan'
            }
          }
          if (input.caller === 'director.plan') {
            return {
              tasks: [
                {
                  id: 'task-collect',
                  title: '整理事实',
                  userInput: '收集并整理当前任务的关键事实和证据'
                }
              ] satisfies AiPlanTask[]
            }
          }
          throw new Error(`unexpected structured call: ${input.caller}`)
        }
      })
      const planGraph = buildDirectorGraph({
        ctx: planCtx,
        runHumanTask: planRunHumanTask
      })
      const planState = (await planGraph.invoke(buildInitialState(runtime))) as AiRunState
      const allEvents = runtime.eventCollector.snapshot()
      const planEvents = allEvents.slice(contextEvents.length)

      const limitedPlanCalls: string[] = []
      const limitedPlanRunHumanTask: HumanTaskRunner = async (
        taskInput
      ): Promise<HumanTaskOutput> => {
        limitedPlanCalls.push(taskInput.taskId)
        if (taskInput.taskId === 'task-limited') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '子任务已完成当前可交付部分，但仍存在材料缺口。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 本任务结论\n已完成当前可交付部分，但仍存在材料缺口。\n\n## 已完成\n- 已确认当前可交付范围。\n\n## 关键事实\n- 仍需补充部分材料。\n\n## 关键证据\n- 当前上下文不足以补齐全部结论。\n\n## 产物与引用\n无\n\n## 未决与风险\n- 材料缺失。\n\n## 对后续任务的影响\n- 后续任务需结合当前限制继续推进。\n\n## 建议下一步\n- 继续执行后续任务并在最终汇总中说明限制。',
            artifacts: [buildArtifact('/tmp/limited-task-output.docx', 'limited task artifact')]
          }
        }

        if (taskInput.taskId === 'task-follow-up') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '后续任务已在限制条件下继续完成。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 本任务结论\n已在现有限制下完成后续整理。\n\n## 已完成\n- 已补充后续整理结果。\n\n## 关键事实\n- 已整合剩余可确认内容。\n\n## 关键证据\n- 已复用前序任务交付。\n\n## 产物与引用\n无\n\n## 未决与风险\n- 仍有材料缺口待补充。\n\n## 对后续任务的影响\n- synthesis 应合并限制说明后统一输出。\n\n## 建议下一步\n- 进入最终汇总。',
            artifacts: [buildArtifact('/tmp/follow-up-output.docx', 'follow-up artifact')]
          }
        }

        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '限制说明已汇总到最终交付。',
          deliveryMarkdown: '# 最终答复\n\n任务已完成当前可交付汇总，并明确标注剩余限制。',
          artifacts: [buildArtifact('/tmp/limited-synthesis-output.docx', 'limited synthesis artifact')]
        }
      }
      const limitedPlanCtx = runtime.createAiRunContext({
        chatStructuredOverride: async (input) => {
          if (input.caller === 'director.intent') {
            return {
              mode: 'to_plan'
            }
          }
          if (input.caller === 'director.plan') {
            return {
              tasks: [
                {
                  id: 'task-limited',
                  title: '受限任务',
                  userInput: '先完成当前可交付部分，并明确记录限制'
                },
                {
                  id: 'task-follow-up',
                  title: '后续整理任务',
                  userInput: '结合前序限制继续整理剩余可确认内容'
                }
              ] satisfies AiPlanTask[]
            }
          }
          throw new Error(`unexpected structured call: ${input.caller}`)
        }
      })
      const limitedPlanGraph = buildDirectorGraph({
        ctx: limitedPlanCtx,
        runHumanTask: limitedPlanRunHumanTask
      })
      const limitedPlanState = (await limitedPlanGraph.invoke(buildInitialState(runtime))) as AiRunState
      const limitedAllEvents = runtime.eventCollector.snapshot()
      const limitedPlanEvents = limitedAllEvents.slice(allEvents.length)

      return {
        directState,
        contextState,
        planState,
        limitedPlanState,
        directCalls,
        contextCalls,
        planCalls,
        limitedPlanCalls,
        directEvents,
        contextEvents,
        planEvents,
        limitedPlanEvents
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.directCalls.join(',') === 'direct-human', {
        name: 'director-direct-dispatch',
        message: 'direct human path should dispatch exactly one direct-human task',
        data: result.directCalls
      })

      runtime.assertThat(result.directState.status === 'completed', {
        name: 'director-direct-status',
        message: 'direct director graph run should complete successfully',
        data: result.directState
      })

      const directTaskEvents = result.directEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') || isEventType(event, 'task_completed')) &&
          event.taskId === 'direct-human'
      )
      runtime.assertThat(directTaskEvents.length === 2, {
        name: 'director-direct-events',
        message: 'direct human dispatch should emit started/completed lifecycle events',
        data: directTaskEvents
      })

      runtime.assertThat(result.planCalls.join(',') === 'task-collect,synthesis-human', {
        name: 'director-plan-synthesis-dispatch',
        message: 'plan flow should dispatch the plan task first and synthesis-human second',
        data: result.planCalls
      })

      runtime.assertThat(
        result.contextCalls.join(',') === 'context-1,task-after-context,synthesis-human',
        {
          name: 'director-context-fallback-dispatch',
          message:
            'context fallback flow should emit the context task first, then fall back to plan task and synthesis-human',
          data: result.contextCalls
        }
      )

      runtime.assertThat(
        result.contextState.contextRounds === 1 &&
          result.contextState.contextEvidence.length === 0 &&
          result.contextState.plan[0]?.status === 'completed' &&
          result.contextState.finalArtifacts.length === 2,
        {
          name: 'director-context-fallback-state',
          message:
            'context fallback flow should keep contextEvidence empty, consume one round, and continue through plan + synthesis',
          data: result.contextState
        }
      )

      runtime.assertThat(
        result.planState.plan.length === 1 &&
          result.planState.plan[0]?.status === 'completed' &&
          result.planState.finalArtifacts.length === 2,
        {
          name: 'director-plan-final-state',
          message: 'plan flow should complete the task, run synthesis, and merge plan + synthesis artifacts',
          data: result.planState
        }
      )

      const planCreatedEvents = result.planEvents.filter((event) => isEventType(event, 'plan_created'))
      const planTaskEvents = result.planEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') || isEventType(event, 'task_completed')) &&
          (event.taskId === 'task-collect' || event.taskId === 'synthesis-human')
      )
      const contextLifecycleEvents = result.contextEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') || isEventType(event, 'task_completed')) &&
          event.taskId === 'context-1'
      )

      runtime.assertThat(planCreatedEvents.length >= 1, {
        name: 'director-plan-created',
        message: 'plan flow should still emit plan_created after shared human dispatch extraction',
        data: planCreatedEvents
      })

      runtime.assertThat(planTaskEvents.length === 4, {
        name: 'director-plan-task-events',
        message: 'plan task and synthesis-human should each emit started/completed lifecycle events',
        data: planTaskEvents
      })

      runtime.assertThat(
        contextLifecycleEvents.length === 2 &&
          contextLifecycleEvents.some((event) => isEventType(event, 'task_started')) &&
          contextLifecycleEvents.some((event) => isEventType(event, 'task_completed')),
        {
          name: 'director-context-completed-events',
          message:
            'context human dispatch should emit started/completed lifecycle events even when no reusable evidence is extracted',
          data: contextLifecycleEvents
        }
      )

      runtime.assertThat(
        result.limitedPlanCalls.join(',') === 'task-limited,task-follow-up,synthesis-human',
        {
          name: 'director-limited-plan-dispatch',
          message:
            'limited-result plan flow should continue dispatching subsequent tasks and then run synthesis-human',
          data: result.limitedPlanCalls
        }
      )

      runtime.assertThat(
        result.limitedPlanState.plan.length === 2 &&
          result.limitedPlanState.plan.every((task) => task.status === 'completed') &&
          result.limitedPlanState.finalArtifacts.length === 3,
        {
          name: 'director-limited-plan-state',
          message:
            'limited-result plan flow should preserve completed task statuses and merge limited-task, follow-up, and synthesis artifacts',
          data: result.limitedPlanState
        }
      )

      const limitedLifecycleEvents = result.limitedPlanEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') || isEventType(event, 'task_completed')) &&
          (event.taskId === 'task-limited' ||
            event.taskId === 'task-follow-up' ||
            event.taskId === 'synthesis-human')
      )
      runtime.assertThat(
        limitedLifecycleEvents.length === 6 &&
          limitedLifecycleEvents.some(
            (event) => isEventType(event, 'task_completed') && event.taskId === 'task-limited'
          ) &&
          limitedLifecycleEvents.some(
            (event) => isEventType(event, 'task_completed') && event.taskId === 'task-follow-up'
          ) &&
          limitedLifecycleEvents.some(
            (event) => isEventType(event, 'task_completed') && event.taskId === 'synthesis-human'
          ),
        {
          name: 'director-limited-plan-events',
          message:
            'limited-result plan flow should emit only started/completed lifecycle events for both business tasks and synthesis',
          data: limitedLifecycleEvents
        }
      )
    }
  })
})

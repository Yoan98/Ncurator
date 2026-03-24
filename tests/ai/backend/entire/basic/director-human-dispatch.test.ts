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
            status: 'blocked',
            summary: '当前缺少上一轮指代所需的上下文。'
          }
        }
        if (taskInput.taskId === 'task-after-context') {
          return {
            taskId: taskInput.taskId,
            status: 'completed',
            summary: '上下文回退后已完成计划子任务。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 任务状态\ncompleted\n\n## 本任务结论\n已在缺少上下文时回退到常规计划执行。\n\n## 已完成\n- 已整理可继续执行的事实。\n\n## 关键事实\n- 当前输入可直接进入后续汇总。\n\n## 关键证据\n- context blocked 后未污染 evidence。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n- synthesis 可继续输出。\n\n## 建议下一步\n- 汇总结果。',
            artifacts: [buildArtifact('/tmp/context-plan-output.docx', 'context fallback artifact')]
          }
        }
        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '上下文回退后的最终汇总完成。',
          deliveryMarkdown: '# 最终答复\n\ncontext blocked 后已正常进入 plan 并完成汇总。',
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
              '# 子任务交付\n\n## 任务状态\ncompleted\n\n## 本任务结论\n已完成事实收集。\n\n## 已完成\n- 已完成关键核对。\n\n## 关键事实\n- 已整理事实。\n\n## 关键证据\n- 已找到证据。\n\n## 产物与引用\n无\n\n## 未决与风险\n无\n\n## 对后续任务的影响\n- synthesis 可直接汇总。\n\n## 建议下一步\n- 继续汇总输出。',
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

      const blockedPlanCalls: string[] = []
      const blockedPlanRunHumanTask: HumanTaskRunner = async (
        taskInput
      ): Promise<HumanTaskOutput> => {
        blockedPlanCalls.push(taskInput.taskId)
        if (taskInput.taskId === 'task-blocked') {
          return {
            taskId: taskInput.taskId,
            status: 'blocked',
            summary: '子任务当前被阻塞。',
            deliveryMarkdown:
              '# 子任务交付\n\n## 任务状态\nblocked\n\n## 本任务结论\n当前任务受阻。\n\n## 已完成\n- 已确认阻塞点。\n\n## 关键事实\n- 需要等待补充材料。\n\n## 关键证据\n- 当前上下文不足。\n\n## 产物与引用\n无\n\n## 未决与风险\n- 材料缺失。\n\n## 对后续任务的影响\n- synthesis 只能做部分交付。\n\n## 建议下一步\n- 补充材料后继续。',
            artifacts: [buildArtifact('/tmp/blocked-task-output.docx', 'blocked task artifact')]
          }
        }

        return {
          taskId: taskInput.taskId,
          status: 'completed',
          summary: '阻塞后已汇总当前状态。',
          deliveryMarkdown: '# 最终答复\n\n任务阻塞，但已完成当前可交付汇总。',
          artifacts: [buildArtifact('/tmp/blocked-synthesis-output.docx', 'blocked synthesis artifact')]
        }
      }
      const blockedPlanCtx = runtime.createAiRunContext({
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
                  id: 'task-blocked',
                  title: '阻塞任务',
                  userInput: '尝试完成当前任务，但允许在证据不足时阻塞'
                }
              ] satisfies AiPlanTask[]
            }
          }
          throw new Error(`unexpected structured call: ${input.caller}`)
        }
      })
      const blockedPlanGraph = buildDirectorGraph({
        ctx: blockedPlanCtx,
        runHumanTask: blockedPlanRunHumanTask
      })
      const blockedPlanState = (await blockedPlanGraph.invoke(buildInitialState(runtime))) as AiRunState
      const blockedAllEvents = runtime.eventCollector.snapshot()
      const blockedPlanEvents = blockedAllEvents.slice(allEvents.length)

      return {
        directState,
        contextState,
        planState,
        blockedPlanState,
        directCalls,
        contextCalls,
        planCalls,
        blockedPlanCalls,
        directEvents,
        contextEvents,
        planEvents,
        blockedPlanEvents
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
            'blocked context flow should emit the context task first, then fall back to plan task and synthesis-human',
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
            'blocked context flow should keep contextEvidence empty, consume one round, and continue through plan + synthesis',
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
          (isEventType(event, 'task_started') ||
            isEventType(event, 'task_blocked') ||
            isEventType(event, 'task_completed')) &&
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
          contextLifecycleEvents.some((event) => isEventType(event, 'task_blocked')) &&
          !contextLifecycleEvents.some((event) => isEventType(event, 'task_completed')),
        {
          name: 'director-context-blocked-events',
          message:
            'context human dispatch should emit started/blocked lifecycle events and must not emit completed when blocked',
          data: contextLifecycleEvents
        }
      )

      runtime.assertThat(result.blockedPlanCalls.join(',') === 'task-blocked,synthesis-human', {
        name: 'director-blocked-plan-dispatch',
        message:
          'blocked plan flow should stop additional task dispatch after the blocked task and continue directly to synthesis-human',
        data: result.blockedPlanCalls
      })

      runtime.assertThat(
        result.blockedPlanState.plan.length === 1 &&
          result.blockedPlanState.plan[0]?.status === 'blocked' &&
          result.blockedPlanState.finalArtifacts.length === 2,
        {
          name: 'director-blocked-plan-state',
          message:
            'blocked plan flow should preserve the blocked task status and still merge blocked-task + synthesis artifacts',
          data: result.blockedPlanState
        }
      )

      const blockedLifecycleEvents = result.blockedPlanEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') ||
            isEventType(event, 'task_blocked') ||
            isEventType(event, 'task_completed')) &&
          (event.taskId === 'task-blocked' || event.taskId === 'synthesis-human')
      )
      runtime.assertThat(
        blockedLifecycleEvents.some(
          (event) => isEventType(event, 'task_blocked') && event.taskId === 'task-blocked'
        ) &&
          blockedLifecycleEvents.some(
            (event) => isEventType(event, 'task_completed') && event.taskId === 'synthesis-human'
          ),
        {
          name: 'director-blocked-plan-events',
          message:
            'blocked plan flow should emit task_blocked for the blocked task and still emit synthesis completion lifecycle events',
          data: blockedLifecycleEvents
        }
      )
    }
  })
})

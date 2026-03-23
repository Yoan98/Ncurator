import { test } from 'vitest'
import { buildDirectorGraph } from '../../../../../src/main/services/ai/director/graph/directorGraph'
import type {
  AiArtifactRef,
  AiPlanTask,
  AiRunEvent
} from '../../../../../src/shared/types'
import type { AiRunState, HumanTaskOutput, HumanTaskRunner } from '../../../../../src/main/services/ai/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const buildInitialState = (runtime: {
  runId: string
}): AiRunState => ({
  runId: runtime.runId,
  sessionId: 'test-session',
  status: 'running',
  input: '整理项目材料并输出最终结论',
  directorStage: 'director_intent',
  contextRounds: 0,
  contextEvidence: [],
  plan: [],
  dispatchCursor: 0,
  finalArtifacts: []
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

      return {
        directState,
        planState,
        directCalls,
        planCalls,
        directEvents,
        allEvents
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
        result.planState.plan.length === 1 &&
          result.planState.plan[0]?.status === 'completed' &&
          result.planState.finalArtifacts.length === 2,
        {
          name: 'director-plan-final-state',
          message: 'plan flow should complete the task, run synthesis, and merge plan + synthesis artifacts',
          data: result.planState
        }
      )

      const planCreatedEvents = result.allEvents.filter((event) => isEventType(event, 'plan_created'))
      const planTaskEvents = result.allEvents.filter(
        (event) =>
          (isEventType(event, 'task_started') || isEventType(event, 'task_completed')) &&
          (event.taskId === 'task-collect' || event.taskId === 'synthesis-human')
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
    }
  })
})

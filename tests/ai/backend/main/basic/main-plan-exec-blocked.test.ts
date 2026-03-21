import type { AiRunState, HumanTaskRunner } from '../../../../../src/main/services/ai/types'
import { createPlanExecNode } from '../../../../../src/main/services/ai/main/node/planExecNode'
import { defineAiMainCase, getEventsByType } from './helpers'

const createPlanExecState = (runtime: { runId: string }): AiRunState => ({
  runId: runtime.runId,
  sessionId: 'test-session',
  status: 'running',
  input: '请按计划执行任务。',
  mainStage: 'main_plan_exec',
  contextRounds: 0,
  contextEvidence: [],
  plan: [
    {
      id: 'task-1',
      title: '核对现状',
      userInput: '读取 workspace 当前状态，并确认关键风险。',
      status: 'ready'
    }
  ],
  dispatchCursor: 0,
  finalArtifacts: []
})

defineAiMainCase({
  caseId: 'main-plan-exec-blocked',
  caseType: 'basic',
  groups: ['basic'],
  description: 'plan_exec 在 human 阻塞时应把任务回写为 blocked，并切到 synthesis。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const ctx = runtime.createAiRunContext()
    const runHumanTask: HumanTaskRunner = async () => ({
      taskId: 'task-1',
      status: 'blocked',
      summary: '缺少必要权限，当前无法继续执行。',
      deliveryMarkdown: '# 阻塞说明',
      artifacts: [
        {
          kind: 'file',
          capability: 'terminal_exec',
          path: '/tmp/blocked-log.txt',
          fileName: 'blocked-log.txt',
          operation: 'created',
          summary: 'blocked task evidence'
        }
      ]
    })
    const node = createPlanExecNode({ ctx, runHumanTask })
    const output = await node(createPlanExecState(runtime))

    return {
      output,
      taskBlockedEvents: getEventsByType(runtime, 'task_blocked')
    }
  },
  assert: async (result, runtime) => {
    const plan = result.output.plan || []
    runtime.assertThat(
      plan[0]?.status === 'blocked' &&
        plan[0]?.deliveryMarkdown === '# 阻塞说明' &&
        plan[0]?.artifacts?.[0]?.kind === 'file' &&
        result.output.mainStage === 'main_synthesis_human',
      {
        name: 'main-plan-exec-blocked-state',
        message: 'plan_exec 应把 blocked 任务写回 plan，并进入 synthesis 收口'
      }
    )
    runtime.assertThat(
      result.taskBlockedEvents.length === 1 &&
        result.taskBlockedEvents[0]?.taskId === 'task-1' &&
        result.taskBlockedEvents[0]?.summary.includes('权限'),
      {
        name: 'main-plan-exec-blocked-event',
        message: 'plan_exec 应发出 task_blocked 事件'
      }
    )
  }
})

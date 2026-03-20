import type { AiRunState } from '../../../../../src/main/services/ai/types'
import { createPlanNode } from '../../../../../src/main/services/ai/main/node/planNode'
import { defineAiMainCase, getEventsByType } from './helpers'

const createBaseState = (runtime: { runId: string }): AiRunState => ({
  runId: runtime.runId,
  sessionId: 'test-session',
  status: 'running',
  input: '请整理一个执行计划。',
  mainStage: 'main_plan',
  contextRounds: 0,
  contextEvidence: ['已有上下文：用户需要先核对现状，再输出修复方案。'],
  plan: [],
  dispatchCursor: 0
})

defineAiMainCase({
  caseId: 'main-plan-created',
  caseType: 'basic',
  groups: ['basic'],
  description: 'plan node 应产出 userInput + ready 的任务列表，并发出 plan_created 事件。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const ctx = runtime.createAiRunContext({
      chatJsonOverride: async () => ({
        tasks: [
          {
            id: 'task-1',
            title: '核对现状',
            userInput: '读取 workspace 当前状态，并确认需要处理的关键风险。'
          }
        ]
      })
    })
    const node = createPlanNode({ ctx })
    const output = await node(createBaseState(runtime))

    return {
      output,
      planCreatedEvents: getEventsByType(runtime, 'plan_created')
    }
  },
  assert: async (result, runtime) => {
    const plan = result.output.plan || []
    runtime.assertThat(
      plan.length === 1 &&
        plan[0]?.userInput === '读取 workspace 当前状态，并确认需要处理的关键风险。' &&
        plan[0]?.status === 'ready',
      {
        name: 'main-plan-created-shape',
        message: 'planner 产物应写入 userInput，并以 ready 作为初始状态'
      }
    )
    runtime.assertThat(
      result.planCreatedEvents.length === 1 &&
        result.planCreatedEvents[0]?.plan[0]?.userInput === plan[0]?.userInput &&
        result.planCreatedEvents[0]?.plan[0]?.status === 'ready',
      {
        name: 'main-plan-created-event',
        message: 'plan_created 事件应投递新的 plan task 契约'
      }
    )
  }
})

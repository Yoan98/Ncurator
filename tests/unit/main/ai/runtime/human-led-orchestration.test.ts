import { describe, expect, test } from 'vitest'
import type { HumanTaskOutput } from '../../../../../src/shared/types'
import { createDirectHumanExecNode } from '../../../../../src/main/services/ai/node/main/directHumanExecNode'
import { createPlanExecNode } from '../../../../../src/main/services/ai/node/main/planExecNode'
import { createSynthesisHumanNode } from '../../../../../src/main/services/ai/node/main/synthesisHumanNode'
import type { AiRunState } from '../../../../../src/main/services/ai/types'
import { createTestAiRunContext } from '../../../../harness/main/contextFactory'
import { EventCollector } from '../../../../harness/main/eventCollector'

const createBaseState = (): AiRunState => ({
  runId: 'run-test',
  sessionId: 'session-test',
  status: 'running',
  input: '请总结当前目录里的规范',
  mainStage: 'main_intent',
  contextRounds: 0,
  contextEvidence: ['intent: to_plan (需要多步任务)'],
  plan: [],
  dispatchCursor: 0
})

const createOutput = (input: Partial<HumanTaskOutput>): HumanTaskOutput => ({
  taskId: input.taskId || 'task-1',
  status: input.status || 'completed',
  summary: input.summary || '任务已完成',
  deliveryMarkdown: input.deliveryMarkdown || '# 子任务交付\n\n## 已完成\n任务已完成',
  resultCode: input.resultCode || 'ok',
  resultData: input.resultData,
  localSourceStatus: input.localSourceStatus,
  localSourceSummary: input.localSourceSummary
})

describe('main ai runtime orchestration', () => {
  test('direct human node should persist final delivery and emit lifecycle events', async () => {
    const eventCollector = new EventCollector()
    const ctx = createTestAiRunContext({
      runId: 'run-direct',
      workspaceRootPath: process.cwd(),
      eventCollector
    })
    const runHumanTask = async (): Promise<HumanTaskOutput> =>
      createOutput({
        taskId: 'direct-human',
        deliveryMarkdown: '# 最终答复\n\n## 结论\n已完成目录总结',
        localSourceStatus: 'used',
        localSourceSummary: '本轮通过本地检索完成总结。'
      })

    const node = createDirectHumanExecNode({ ctx, runHumanTask })
    const result = await node(createBaseState())

    expect(result.mainStage).toBe('main_complete')
    expect(result.finalDeliveryTaskId).toBe('direct-human')
    expect(result.finalDeliveryMarkdown).toContain('# 最终答复')
    expect(result.localSourceStatus).toBe('used')
    expect(eventCollector.snapshot().map((event) => event.type)).toEqual([
      'task_started',
      'task_completed',
      'task_result'
    ])
  })

  test('plan exec should compile prior handoff and stop dispatch on blocked task', async () => {
    const eventCollector = new EventCollector()
    const ctx = createTestAiRunContext({
      runId: 'run-plan',
      workspaceRootPath: process.cwd(),
      eventCollector
    })
    const receivedObjectives: string[] = []
    const runHumanTask = async (taskInput: { taskId: string; objective: string }) => {
      receivedObjectives.push(taskInput.objective)
      return createOutput({
        taskId: taskInput.taskId,
        summary: taskInput.taskId === 'task-2' ? '第二步阻塞' : '第一步完成',
        deliveryMarkdown:
          taskInput.taskId === 'task-2'
            ? '# 子任务交付\n\n## 已完成\n已发现阻塞\n\n## 风险与未决\n第二步阻塞'
            : '# 子任务交付\n\n## 已完成\n第一步完成\n\n## 建议后续步骤\n继续 task-2',
        status: taskInput.taskId === 'task-2' ? 'blocked' : 'completed',
        resultCode: taskInput.taskId === 'task-2' ? 'failed' : 'ok'
      })
    }

    const node = createPlanExecNode({ ctx, runHumanTask })

    const firstState = await node({
      ...createBaseState(),
      mainStage: 'main_plan_exec',
      plan: [
        { id: 'task-1', title: 'Task 1', objective: '读取目录', status: 'pending', attempts: 0 },
        { id: 'task-2', title: 'Task 2', objective: '分析阻塞', status: 'pending', attempts: 0 }
      ]
    })

    expect(firstState.mainStage).toBe('main_plan_exec')
    expect(firstState.plan?.[0].deliveryMarkdown).toContain('第一步完成')

    const secondState = await node({
      ...createBaseState(),
      mainStage: 'main_plan_exec',
      dispatchCursor: 1,
      plan: [
        {
          id: 'task-1',
          title: 'Task 1',
          objective: '读取目录',
          status: 'completed',
          attempts: 1,
          resultMessage: '第一步完成',
          deliveryMarkdown: '# 子任务交付\n\n## 已完成\n第一步完成\n\n## 建议后续步骤\n继续 task-2'
        },
        { id: 'task-2', title: 'Task 2', objective: '分析阻塞', status: 'pending', attempts: 0 }
      ]
    })

    expect(receivedObjectives[1]).toContain('前序任务交付')
    expect(receivedObjectives[1]).toContain('第一步完成')
    expect(secondState.mainStage).toBe('main_synthesis_human')
    expect(secondState.plan?.[1].status).toBe('failed')
    expect(eventCollector.snapshot().some((event) => event.type === 'task_failed')).toBe(true)
  })

  test('synthesis human node should persist final delivery after planned tasks', async () => {
    const eventCollector = new EventCollector()
    const ctx = createTestAiRunContext({
      runId: 'run-synthesis',
      workspaceRootPath: process.cwd(),
      eventCollector
    })
    const runHumanTask = async (taskInput: { taskId: string; objective: string }) => {
      expect(taskInput.objective).toContain('全部任务交付')
      expect(taskInput.objective).toContain('任务 1')
      return createOutput({
        taskId: 'synthesis-human',
        deliveryMarkdown: '# 最终答复\n\n## 结论\n汇总完成'
      })
    }

    const node = createSynthesisHumanNode({ ctx, runHumanTask })
    const result = await node({
      ...createBaseState(),
      mainStage: 'main_synthesis_human',
      plan: [
        {
          id: 'task-1',
          title: 'Task 1',
          objective: '读取目录',
          status: 'completed',
          attempts: 1,
          resultMessage: '第一步完成',
          deliveryMarkdown: '# 子任务交付\n\n## 已完成\n第一步完成'
        }
      ]
    })

    expect(result.mainStage).toBe('main_complete')
    expect(result.finalDeliveryTaskId).toBe('synthesis-human')
    expect(result.finalDeliveryMarkdown).toContain('汇总完成')
  })
})

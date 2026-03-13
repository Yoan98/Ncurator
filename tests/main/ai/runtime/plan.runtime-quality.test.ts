import { describe, test } from 'vitest'
import type { HumanTaskOutput } from '../../../../src/shared/types'
import { createPlanExecNode } from '../../../../src/main/services/ai/node/main/planExecNode'
import { createSynthesisHumanNode } from '../../../../src/main/services/ai/node/main/synthesisHumanNode'
import type { AiRunState } from '../../../../src/main/services/ai/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'

const HANDOFF_METADATA = {
  description: '验证 plan runtime 在三步 handoff 链下持续注入前序交付，并在最终进入 synthesis human。',
  taskGoal: '确认 plan runtime 的长 handoff 链不会在后续 objective 中丢失前序交付内容。',
  scenarioTags: ['runtime', 'plan', 'handoff-chain', 'synthesis'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

const BLOCKED_METADATA = {
  description: '验证 plan runtime 在中途业务任务阻塞后会停派发，但仍进入 synthesis 汇总已完成结果与阻塞原因。',
  taskGoal: '确认阻塞后的 plan runtime 仍按 stop-dispatch + synthesis 收口，而不是继续派发后续业务任务。',
  scenarioTags: ['runtime', 'plan', 'blocked', 'synthesis'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

const MIXED_SCOPE_METADATA = {
  description: '验证 mixed-scope plan runtime 会把 selected scope summary 编译进业务任务和 synthesis objective。',
  taskGoal: '确认 plan task objective 与 synthesis objective 在 mixed-scope 场景下继续保留资料范围语义。',
  scenarioTags: ['runtime', 'plan', 'mixed-scope', 'objective'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

const createBaseState = (): AiRunState => ({
  runId: 'run-plan-runtime',
  sessionId: 'session-plan-runtime',
  status: 'running',
  input: '请推进 AI plan 质量测试',
  mainStage: 'main_plan_exec',
  contextRounds: 0,
  contextEvidence: ['intent: to_plan (需要多步任务)', 'scope: workspace + web selected'],
  plan: [],
  dispatchCursor: 0
})

const createOutput = (input: Partial<HumanTaskOutput>): HumanTaskOutput => ({
  taskId: input.taskId || 'task-1',
  status: input.status || 'completed',
  summary: input.summary || '任务已完成',
  deliveryMarkdown:
    input.deliveryMarkdown || '# 子任务交付\n\n## 已完成\n任务已完成\n\n## 建议后续步骤\n继续后续任务',
  resultCode: input.resultCode || 'ok',
  resultData: input.resultData,
  localSourceStatus: input.localSourceStatus,
  localSourceSummary: input.localSourceSummary
})

describe('main/ai/runtime/plan quality', () => {
  test('plan runtime should preserve a three-step handoff chain into synthesis', async () => {
    await runRuntimeCase({
      caseId: 'plan-handoff-chain-3-step',
      description: HANDOFF_METADATA.description,
      caseMetadata: HANDOFF_METADATA,
      expectedOutcome: HANDOFF_METADATA.expectedOutcome,
      scenarioTags: HANDOFF_METADATA.scenarioTags,
      requiredFixtures: HANDOFF_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'three-step handoff chain preserved into synthesis'
      }),
      execute: async (runtime) => {
        const receivedObjectives: string[] = []
        const ctx = runtime.ctx
        const runHumanTask = async (taskInput: { taskId: string; objective: string }) => {
          receivedObjectives.push(taskInput.objective)
          const sequence = receivedObjectives.length
          const output = createOutput({
            taskId: taskInput.taskId,
            summary: `第 ${sequence} 步完成`,
            deliveryMarkdown: `# 子任务交付\n\n## 已完成\n第 ${sequence} 步完成\n\n## 建议后续步骤\n继续 task-${sequence + 1}`
          })
          ctx.sendEvent({
            type: 'task_delivery_ready',
            runId: runtime.runId,
            taskId: taskInput.taskId,
            summary: output.summary,
            deliveryMarkdown: output.deliveryMarkdown,
            createdAt: Date.now(),
            stage: 'human_response'
          })
          return output
        }

        const planExecNode = createPlanExecNode({ ctx, runHumanTask })
        const synthesisNode = createSynthesisHumanNode({
          ctx,
          runHumanTask: async (taskInput) => {
            receivedObjectives.push(taskInput.objective)
            const output = createOutput({
              taskId: 'synthesis-human',
              summary: '最终汇总完成',
              deliveryMarkdown: '# 最终答复\n\n## 结论\n已完成 handoff 汇总'
            })
            ctx.sendEvent({
              type: 'task_delivery_ready',
              runId: runtime.runId,
              taskId: 'synthesis-human',
              summary: output.summary,
              deliveryMarkdown: output.deliveryMarkdown,
              createdAt: Date.now(),
              stage: 'human_response'
            })
            return output
          }
        })

        const plan = [
          { id: 'task-1', title: 'Task 1', objective: '读取现有 plan 约束并列出 3 条关键点', status: 'pending' as const, attempts: 0 },
          { id: 'task-2', title: 'Task 2', objective: '根据 task-1 结果整理 planner contract case，并输出 caseId 列表', status: 'pending' as const, attempts: 0 },
          { id: 'task-3', title: 'Task 3', objective: '根据前两步交付整理 runtime handoff case，并输出断言目标', status: 'pending' as const, attempts: 0 }
        ]

        const afterFirst = await planExecNode({ ...createBaseState(), plan })
        const afterSecond = await planExecNode({
          ...createBaseState(),
          plan: afterFirst.plan || [],
          dispatchCursor: afterFirst.dispatchCursor || 1
        })
        const afterThird = await planExecNode({
          ...createBaseState(),
          plan: afterSecond.plan || [],
          dispatchCursor: afterSecond.dispatchCursor || 2
        })
        const finalState = await synthesisNode({
          ...createBaseState(),
          mainStage: 'main_synthesis_human',
          plan: afterThird.plan || []
        })

        return {
          receivedObjectives,
          afterThird,
          finalState,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.second-task-contains-first-delivery',
          pass:
            result.receivedObjectives[1]?.includes('前序任务交付') &&
            result.receivedObjectives[1]?.includes('第 1 步完成'),
          details: result.receivedObjectives[1]
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.third-task-contains-prior-deliveries',
          pass:
            result.receivedObjectives[2]?.includes('第 1 步完成') &&
            result.receivedObjectives[2]?.includes('第 2 步完成'),
          details: result.receivedObjectives[2]
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.synthesis-triggered-after-three-steps',
          pass:
            result.afterThird.mainStage === 'main_synthesis_human' &&
            result.finalState.finalDeliveryTaskId === 'synthesis-human',
          details: JSON.stringify({
            afterThirdStage: result.afterThird.mainStage,
            finalDeliveryTaskId: result.finalState.finalDeliveryTaskId
          })
        })
      }
    })
  })

  test('blocked plan task should stop dispatch and still enter synthesis', async () => {
    await runRuntimeCase({
      caseId: 'plan-blocked-midway-still-synthesizes',
      description: BLOCKED_METADATA.description,
      caseMetadata: BLOCKED_METADATA,
      expectedOutcome: BLOCKED_METADATA.expectedOutcome,
      scenarioTags: BLOCKED_METADATA.scenarioTags,
      requiredFixtures: BLOCKED_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'blocked plan task still synthesized final delivery'
      }),
      execute: async (runtime) => {
        const dispatchedTaskIds: string[] = []
        const ctx = runtime.ctx
        const runHumanTask = async (taskInput: { taskId: string }) => {
          dispatchedTaskIds.push(taskInput.taskId)
          const blocked = taskInput.taskId === 'task-2'
          const output = createOutput({
            taskId: taskInput.taskId,
            status: blocked ? 'blocked' : 'completed',
            resultCode: blocked ? 'failed' : 'ok',
            summary: blocked ? '第二步缺少关键证据，当前阻塞' : '第一步完成',
            deliveryMarkdown: blocked
              ? '# 子任务交付\n\n## 已完成\n已确认阻塞\n\n## 风险与未决\n第二步缺少关键证据'
              : '# 子任务交付\n\n## 已完成\n第一步完成\n\n## 建议后续步骤\n继续 task-2'
          })
          ctx.sendEvent({
            type: 'task_delivery_ready',
            runId: runtime.runId,
            taskId: taskInput.taskId,
            summary: output.summary,
            deliveryMarkdown: output.deliveryMarkdown,
            createdAt: Date.now(),
            stage: 'human_response'
          })
          return output
        }

        const planExecNode = createPlanExecNode({ ctx, runHumanTask })
        const synthesisNode = createSynthesisHumanNode({
          ctx,
          runHumanTask: async () => {
            const output = createOutput({
              taskId: 'synthesis-human',
              summary: '已汇总完成部分与阻塞原因',
              deliveryMarkdown: '# 最终答复\n\n## 结论\n当前已完成第一步，第二步因证据不足阻塞'
            })
            ctx.sendEvent({
              type: 'task_delivery_ready',
              runId: runtime.runId,
              taskId: 'synthesis-human',
              summary: output.summary,
              deliveryMarkdown: output.deliveryMarkdown,
              createdAt: Date.now(),
              stage: 'human_response'
            })
            return output
          }
        })

        const initialPlan = [
          { id: 'task-1', title: 'Task 1', objective: '读取现有测试计划并列出关键约束', status: 'pending' as const, attempts: 0 },
          { id: 'task-2', title: 'Task 2', objective: '根据约束补齐缺失证据并整理风险', status: 'pending' as const, attempts: 0 },
          { id: 'task-3', title: 'Task 3', objective: '继续派发不应执行到的后续任务', status: 'pending' as const, attempts: 0 }
        ]

        const afterFirst = await planExecNode({ ...createBaseState(), plan: initialPlan })
        const afterSecond = await planExecNode({
          ...createBaseState(),
          plan: afterFirst.plan || [],
          dispatchCursor: afterFirst.dispatchCursor || 1
        })
        const finalState = await synthesisNode({
          ...createBaseState(),
          mainStage: 'main_synthesis_human',
          plan: afterSecond.plan || []
        })

        return {
          dispatchedTaskIds,
          afterSecond,
          finalState,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.stop-dispatch-after-blocked-task',
          pass: !result.dispatchedTaskIds.includes('task-3'),
          details: JSON.stringify(result.dispatchedTaskIds)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.blocked-task-transitions-to-synthesis',
          pass:
            result.afterSecond.mainStage === 'main_synthesis_human' &&
            result.afterSecond.plan?.[1]?.status === 'failed',
          details: JSON.stringify(result.afterSecond)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.blocked-task-still-has-final-delivery',
          pass:
            result.finalState.finalDeliveryTaskId === 'synthesis-human' &&
            String(result.finalState.finalDeliveryMarkdown || '').includes('阻塞'),
          details: JSON.stringify(result.finalState)
        })
      }
    })
  })

  test('mixed-scope objectives should preserve selected scope summary through runtime', async () => {
    await runRuntimeCase({
      caseId: 'plan-mixed-scope-objective-preserve',
      description: MIXED_SCOPE_METADATA.description,
      caseMetadata: MIXED_SCOPE_METADATA,
      expectedOutcome: MIXED_SCOPE_METADATA.expectedOutcome,
      scenarioTags: MIXED_SCOPE_METADATA.scenarioTags,
      requiredFixtures: MIXED_SCOPE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'mixed-scope objective preservation verified'
      }),
      execute: async (runtime) => {
        const mixedScopeSummary = [
          '1. workspace:产品规范库 (docs/specs) | prepared=2 | unprepared=0 | workspace=workspace-alpha',
          '2. web:架构说明页面 | prepared=1 | unprepared=0',
          '允许非本地信息: 否'
        ].join('\n')

        const receivedObjectives: string[] = []
        const ctx = {
          ...runtime.ctx,
          selectedScopeSummary: mixedScopeSummary
        }
        const planExecNode = createPlanExecNode({
          ctx,
          runHumanTask: async (taskInput) => {
            receivedObjectives.push(taskInput.objective)
            return createOutput({
              taskId: taskInput.taskId,
              summary: 'mixed-scope 子任务完成',
              deliveryMarkdown: '# 子任务交付\n\n## 已完成\n已按 mixed-scope 约束完成子任务'
            })
          }
        })
        const synthesisNode = createSynthesisHumanNode({
          ctx,
          runHumanTask: async (taskInput) => {
            receivedObjectives.push(taskInput.objective)
            return createOutput({
              taskId: 'synthesis-human',
              summary: 'mixed-scope 汇总完成',
              deliveryMarkdown: '# 最终答复\n\n## 结论\n已按指定范围完成汇总'
            })
          }
        })

        const afterPlan = await planExecNode({
          ...createBaseState(),
          plan: [
            {
              id: 'task-1',
              title: 'Task 1',
              objective: '读取 workspace 与 web 已选范围，并整理 plan quality 的混合取证约束',
              status: 'pending',
              attempts: 0
            }
          ]
        })
        await synthesisNode({
          ...createBaseState(),
          mainStage: 'main_synthesis_human',
          plan: afterPlan.plan || []
        })

        return {
          mixedScopeSummary,
          receivedObjectives
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.task-objective-keeps-mixed-scope-summary',
          pass:
            result.receivedObjectives[0]?.includes('已选资料范围') &&
            result.receivedObjectives[0]?.includes('workspace:产品规范库') &&
            result.receivedObjectives[0]?.includes('web:架构说明页面'),
          details: result.receivedObjectives[0]
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.runtime.synthesis-objective-keeps-mixed-scope-summary',
          pass:
            result.receivedObjectives[1]?.includes('已选资料范围') &&
            result.receivedObjectives[1]?.includes('workspace:产品规范库') &&
            result.receivedObjectives[1]?.includes('web:架构说明页面'),
          details: result.receivedObjectives[1]
        })
      }
    })
  })
})

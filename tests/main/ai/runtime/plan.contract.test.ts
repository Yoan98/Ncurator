import { describe, test } from 'vitest'
import { createPlanNode } from '../../../../src/main/services/ai/node/main/planNode'
import { buildPlanPrompt } from '../../../../src/main/services/ai/prompts/main/plan'
import type { AiRunState } from '../../../../src/main/services/ai/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { createTestAiRunContext } from '../../../harness/main/contextFactory'

const PLAN_CONTRACT_METADATA = {
  description: '验证 planner contract 会拒绝 final-summary task 与空泛 objective，并保留确定性的 plan fail-fast 结果。',
  taskGoal:
    '确认 plan 节点会拒绝“最终答复/最终总结”类业务任务和过于空泛的 objective，同时保留合法计划的创建能力。',
  scenarioTags: ['runtime', 'plan', 'contract', 'planner-validation'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

const PLAN_SCOPE_METADATA = {
  description: '验证 planner prompt 会继续携带 selected scope 约束，并在计划创建时保留范围语义。',
  taskGoal: '确认 plan prompt 把已选资料范围与 local-first 约束持续传给 planner，而不是在 planning 阶段丢失。',
  scenarioTags: ['runtime', 'plan', 'scope', 'prompt'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'ai-runtime'
} as const

const createBaseState = (): AiRunState => ({
  runId: 'run-plan-contract',
  sessionId: 'session-plan-contract',
  status: 'running',
  input: '请为 AI plan 测试整理执行方案',
  mainStage: 'main_plan',
  contextRounds: 0,
  contextEvidence: ['intent: to_plan (需要多步任务)'],
  plan: [],
  dispatchCursor: 0
})

describe('main/ai/runtime/plan contract', () => {
  test('plan node should reject final-summary tasks and generic objectives', async () => {
    await runRuntimeCase({
      caseId: 'plan-contract-validation',
      description: PLAN_CONTRACT_METADATA.description,
      caseMetadata: PLAN_CONTRACT_METADATA,
      expectedOutcome: PLAN_CONTRACT_METADATA.expectedOutcome,
      scenarioTags: PLAN_CONTRACT_METADATA.scenarioTags,
      requiredFixtures: PLAN_CONTRACT_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => ({
        status: 'completed',
        resultCode: 'ok',
        summary: `summaryRejected=${result.summaryRejected}; genericRejected=${result.genericRejected}; validTasks=${result.validPlanLength}`
      }),
      execute: async (runtime) => {
        const summaryCtx = {
          ...createTestAiRunContext({
            runId: 'run-plan-summary-invalid',
            workspaceRootPath: runtime.workspaceRoot,
            eventCollector: runtime.eventCollector
          }),
          chatJson: async () => ({
            tasks: [{ title: 'Task 1', objective: '汇总全部任务并输出最终答复' }]
          })
        }
        const genericCtx = {
          ...createTestAiRunContext({
            runId: 'run-plan-generic-invalid',
            workspaceRootPath: runtime.workspaceRoot,
            eventCollector: runtime.eventCollector
          }),
          chatJson: async () => ({
            tasks: [{ title: 'Task 1', objective: '继续优化文档质量' }]
          })
        }
        const validCtx = {
          ...runtime.ctx,
          chatJson: async () => ({
            tasks: [
              {
                id: 'task-plan-1',
                title: '提取现有约束',
                objective: '读取 doc/testing/phased-plan.md 并列出 3 条需要纳入 plan quality baseline 的约束'
              },
              {
                id: 'task-plan-2',
                title: '整理测试矩阵',
                objective: '根据已提取约束整理 plan quality case matrix，并输出 caseId、覆盖目标与预期信号'
              }
            ]
          })
        }

        const summaryResult = await createPlanNode({ ctx: summaryCtx })(createBaseState())
        const genericResult = await createPlanNode({ ctx: genericCtx })(createBaseState())
        const validResult = await createPlanNode({ ctx: validCtx })(createBaseState())

        return {
          summaryResult,
          genericResult,
          validResult,
          summaryRejected: String(summaryResult.error || ''),
          genericRejected: String(genericResult.error || ''),
          validPlanLength: Array.isArray(validResult.plan) ? validResult.plan.length : 0
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.contract.rejects-final-summary-task',
          pass:
            result.summaryResult.status === 'failed' &&
            String(result.summaryResult.error || '').includes('planner must not create final summary task'),
          details: JSON.stringify(result.summaryResult)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.contract.rejects-generic-objective',
          pass:
            result.genericResult.status === 'failed' &&
            String(result.genericResult.error || '').includes(
              'objective must be concrete and verifiable'
            ),
          details: JSON.stringify(result.genericResult)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.contract.creates-valid-plan',
          pass:
            result.validResult.mainStage === 'main_plan_exec' &&
            Array.isArray(result.validResult.plan) &&
            result.validResult.plan.length === 2,
          details: JSON.stringify(result.validResult)
        })
      }
    })
  })

  test('plan prompt should preserve selected scope summary and local-first constraints', async () => {
    await runRuntimeCase({
      caseId: 'plan-prompt-scope-preserve',
      description: PLAN_SCOPE_METADATA.description,
      caseMetadata: PLAN_SCOPE_METADATA,
      expectedOutcome: PLAN_SCOPE_METADATA.expectedOutcome,
      scenarioTags: PLAN_SCOPE_METADATA.scenarioTags,
      requiredFixtures: PLAN_SCOPE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'plan prompt scope preservation verified'
      }),
      execute: async () => {
        const selectedScopeSummary = [
          '1. workspace:产品规范库 (docs/specs) | prepared=2 | unprepared=0 | workspace=workspace-alpha',
          '2. web:架构设计说明 | prepared=1 | unprepared=0',
          '允许非本地信息: 否'
        ].join('\n')

        const prompt = buildPlanPrompt({
          userInput: '请规划一轮 AI plan 质量测试',
          sessionSummaryText: '当前正在整理 AI plan 质量阶段输入。',
          recentTurnsText: 'user: 需要覆盖长 handoff 链和多资料范围混合\nassistant: 先从 planner contract 和 runtime quality 拆开',
          contextEvidence: ['need_context resolved: selected scope already prepared'],
          selectedScopeSummary
        })

        return {
          prompt,
          selectedScopeSummary
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.prompt.includes-selected-scope-summary',
          pass: result.prompt.user.includes(result.selectedScopeSummary),
          details: result.prompt.user
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.prompt.keeps-runtime-owned-synthesis-boundary',
          pass:
            result.prompt.system.includes('最终总结由 runtime 自动追加 synthesis human 负责') &&
            result.prompt.system.includes('不要把“总结答复”写成计划中的业务任务'),
          details: result.prompt.system
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.prompt.demands-concrete-objective',
          pass:
            result.prompt.system.includes('动作 + 对象 + 完成判据') &&
            result.prompt.system.includes('继续优化文档质量'),
          details: result.prompt.system
        })
      }
    })
  })
})

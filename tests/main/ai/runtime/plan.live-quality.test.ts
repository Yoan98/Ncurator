import { describe, expect, test } from 'vitest'
import { createPlanNode } from '../../../../src/main/services/ai/node/main/planNode'
import type { AiRunState } from '../../../../src/main/services/ai/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { createTestAiRunContext } from '../../../harness/main/contextFactory'
import { isLiveSuiteEnabled, loadLiveLlmConfigFromEnv } from '../../../harness/main/llmConfig'

const CASE_ID = 'plan-live-long-handoff-quality'
const CASE_METADATA = {
  description: '验证 main-ai-runtime 在真实模型下能生成不少于两步的 plan，且不会把 synthesis/final answer 混入业务任务。',
  taskGoal:
    '请规划一次 AI plan 质量测试：先提取仓库中的 plan 质量约束，再整理 deterministic case matrix，最后给出 live quality 采样建议。不要生成最终总结任务。',
  scenarioTags: ['runtime', 'plan', 'live', 'quality'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'ai-runtime'
} as const

const createBaseState = (): AiRunState => ({
  runId: 'run-live-plan-quality',
  sessionId: 'session-live-plan-quality',
  status: 'running',
  input: CASE_METADATA.taskGoal,
  mainStage: 'main_plan',
  contextRounds: 0,
  contextEvidence: ['intent: to_plan (需要先取证再整理测试矩阵)'],
  plan: [],
  dispatchCursor: 0
})

describe('main/ai/runtime/plan live quality', () => {
  test.skipIf(!isLiveSuiteEnabled())('live planner should create a multi-step plan without summary-task leakage', async () => {
    await runRuntimeCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => ({
        status: 'completed',
        resultCode: 'ok',
        summary: `live planner generated ${result.planLength} tasks`
      }),
      execute: async (runtime) => {
        const liveConfig = loadLiveLlmConfigFromEnv()
        const ctx = {
          ...createTestAiRunContext({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot,
            eventCollector: runtime.eventCollector,
            liveModelConfig: liveConfig
          }),
          selectedScopeSummary: [
            '1. workspace:AI 测试规范 (doc/test) | prepared=2 | unprepared=0 | workspace=test-workspace',
            '2. web:OpenSpec 工作流说明 | prepared=1 | unprepared=0',
            '允许非本地信息: 否'
          ].join('\n')
        }

        const result = await createPlanNode({ ctx })(createBaseState())
        return {
          result,
          planLength: Array.isArray(result.plan) ? result.plan.length : 0,
          objectives: Array.isArray(result.plan) ? result.plan.map((item) => item.objective) : []
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'plan.live.created-multi-step-plan',
          pass:
            result.result.mainStage === 'main_plan_exec' &&
            Array.isArray(result.result.plan) &&
            result.result.plan.length >= 2,
          details: JSON.stringify(result.result)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.live.no-summary-task-leakage',
          pass: result.objectives.every(
            (objective) => !/最终答复|最终总结|总结答复|synthesis|final answer/i.test(objective)
          ),
          details: JSON.stringify(result.objectives)
        })
        recordAssertion(runtime.assertions, {
          id: 'plan.live.objectives-not-generic',
          pass: result.objectives.every((objective) => !/^继续(?:优化|分析|处理|推进)/.test(objective)),
          details: JSON.stringify(result.objectives)
        })
      }
    })
  }, 240000)

  test('runtime live plan case remains batch-only and disabled by default', async () => {
    expect(CASE_METADATA.runPolicy).toBe('batch_only')
    expect(CASE_METADATA.retentionTier).toBe('live-eval')
  })
})

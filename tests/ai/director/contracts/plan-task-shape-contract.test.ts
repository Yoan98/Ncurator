import { describe, it } from 'vitest'
import { buildPlanPrompt } from '../../../../src/main/services/ai/director/prompts/plan'
import {
  planDecisionSchema,
  toPlanTasks,
  validatePlannerTasks
} from '../../../../src/main/services/ai/director/node/helpers'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai director contracts backend', () => {
  it('plan-task-shape-contract', async () => {
    await runBackendCase({
      caseId: 'plan-task-shape-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 planner prompt 的任务形状约束与基础结构兜底校验。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const prompt = buildPlanPrompt({
          userInput: '请先整理规则，再修改文档，最后给我可交付结果。',
          sessionSummaryText: '之前用户一直在追踪发布说明与术语一致性。',
          recentTurnsText: '用户刚刚确认只使用当前已选资料。',
          contextEvidence: ['已确认需优先参考当前本地资料。'],
          selectedContextText: 'workspace:test-workspace'
        })
        const validDecision = planDecisionSchema.parse({
          tasks: [
            {
              id: 'task-1',
              title: '提取规则',
              userInput:
                '读取已选规则文档，提取术语统一要求，并输出带引用的规则清单。'
            }
          ]
        })

        return {
          prompt,
          validDecision,
          emptyPlanError: validatePlannerTasks([]),
          readyPlan: toPlanTasks(validDecision.tasks)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.prompt.system.includes('最终总结、综合答复、汇总成文这类 synthesis 工作由 runtime 追加，不要写进 tasks。') &&
            result.prompt.system.includes(
              'task.userInput 必须明确写出动作、对象和完成判据，避免“继续处理”“再看看”“优化一下”这类空泛描述。'
            ),
          {
            name: 'plan-prompt-contains-shape-and-synthesis-guardrails',
            message:
              'plan-task-shape-contract 应把“动作/对象/完成判据”与“不要把最终总结写成业务 task”明确写入 planner prompt 约束。',
            data: {
              systemPrompt: result.prompt.system
            }
          }
        )

        runtime.assertThat(
          result.emptyPlanError === 'tasks: at least one task is required' &&
            result.readyPlan.length === 1 &&
            result.readyPlan[0]?.status === 'ready' &&
            result.readyPlan[0]?.userInput.includes('输出带引用的规则清单'),
          {
            name: 'plan-helpers-fail-fast-on-empty-and-preserve-executable-tasks',
            message:
              'plan-task-shape-contract 至少应保证空计划 fail-fast，且结构化 task 转换后仍保持可执行的 ready task 形状。',
            data: {
              emptyPlanError: result.emptyPlanError,
              readyPlan: result.readyPlan
            }
          }
        )
      }
    })
  })
})

import type { AiRunContext, AiRunState } from '../../types'
import { planDecisionSchema, toPlanTasks } from './helpers'

export const createMainPlanNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const history = await ctx.loadHistory({
      recentTurns: 12,
      maxRecentTurnsChars: 4000,
      maxSummaryChars: 1000,
      maxLocalInstructionItems: 20,
      maxLocalInstructionChars: 120
    })

    const raw = await ctx.chatJson({
      system: [
        '你是 main_plan_node。',
        '只输出 JSON: {"tasks":[{"id","title","objective","kindHint"}]}',
        'kindHint 可选，仅允许 local_kb_retrieval / terminal_exec / docx。',
        '请把任务拆成可独立执行的单任务。'
      ].join('\n'),
      user: [
        `用户输入:\n${state.input}`,
        `会话摘要:\n${history.sessionSummaryText || '(none)'}`,
        `最近对话:\n${history.recentTurnsText || '(none)'}`,
        `上下文证据:\n${state.contextEvidence.join('\n') || '(none)'}`
      ].join('\n\n'),
      temperature: 0.1
    })

    const parsed = planDecisionSchema.safeParse(raw)
    // 计划生成失败时回退到最小可执行任务，保证主流程可继续推进。
    const plan = parsed.success
      ? toPlanTasks(parsed.data.tasks)
      : toPlanTasks([
          {
            id: 'task-1',
            title: '默认检索任务',
            objective: state.input,
            kindHint: 'local_kb_retrieval'
          }
        ])

    ctx.sendEvent({
      type: 'plan_created',
      runId: state.runId,
      plan,
      stage: 'main_plan'
    })

    return {
      plan,
      dispatchCursor: 0,
      mainStage: 'main_dispatch'
    }
  }
}

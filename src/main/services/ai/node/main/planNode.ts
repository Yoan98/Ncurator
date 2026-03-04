import type { AiRunContext, AiRunState } from '../../types'
import { planDecisionSchema, toPlanTasks } from './helpers'

export const createPlanNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const history = await ctx.loadHistory({
      recentTurns: 12,
      maxRecentTurnsChars: 4000,
      maxSummaryChars: 1000
    })

    const raw = await ctx.chatJson({
      system: [
        '你是 plan_node。',
        '只输出 JSON: {"tasks":[{"id","title","objective"}]}',
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
    if (!parsed.success) {
      const parseReason = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
          return `${path}: ${issue.message}`
        })
        .join('; ')

      return {
        status: 'failed',
        error: `plan_generation_failed: ${parseReason || 'invalid planner output'}`,
        outputText: '计划生成失败：模型输出不符合任务结构要求。',
        mainStage: 'main_finalize'
      }
    }

    const plan = toPlanTasks(parsed.data.tasks)

    ctx.sendEvent({
      type: 'plan_created',
      runId: state.runId,
      plan,
      stage: 'main_plan'
    })

    return {
      plan,
      dispatchCursor: 0,
      mainStage: 'main_plan_exec'
    }
  }
}

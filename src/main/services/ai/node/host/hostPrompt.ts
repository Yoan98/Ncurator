import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../llm/chatModel'
import { getMessageText } from '../../../../utils/aiCapabilityUtils'
import type { AiRunContext, AiRunState } from '../../types'

const formatLines = (items: string[]): string => {
  if (!Array.isArray(items) || items.length === 0) return '(none)'
  return items.map((item, index) => `${index + 1}. ${String(item || '').trim()}`).join('\n')
}

const buildPlanText = (plan: AiRunState['plan']): string => {
  if (!Array.isArray(plan) || plan.length === 0) return '(none)'
  return plan
    .map((task) => `${task.id} | ${task.kind} | ${task.status}${task.error ? ` | ${task.error}` : ''}`)
    .join('\n')
}

export const buildHostDecisionPrompt = (input: {
  state: AiRunState
  history: {
    recentTurnsText: string
    sessionSummaryText: string
    localInstructions: string[]
  }
}): { system: string; user: string } => {
  const { state, history } = input
  const evidenceText = formatLines(state.contextEvidence || [])
  const localInstructionsText = formatLines(history.localInstructions || [])

  const system = [
    '你是桌面 AI 运行时中的 host 决策器。',
    '你每轮必须且只能调用一个工具：retrieve_context、create_plan、final_answer。',
    '决策原则：',
    '1) 信息不足时，调用 retrieve_context，并选择最合适的 capabilityKind（local_kb_retrieval / terminal_exec / docx）。',
    '2) 需要执行动作时，调用 create_plan 并给出任务数组。',
    '3) 已可直接答复时，调用 final_answer。',
    '若无法调用工具，输出 JSON 兜底格式：',
    '{"action":"retrieve_context"|"create_plan"|"final_answer", ...}'
  ].join('\n')

  const user = [
    `用户输入:\n${state.input}`,
    `会话摘要:\n${history.sessionSummaryText || '(none)'}`,
    `最近对话:\n${history.recentTurnsText || '(none)'}`,
    `本地指令包:\n${localInstructionsText}`,
    `已收集证据:\n${evidenceText}`,
    `当前循环计数:\n决策轮次 ${state.hostDecisionRounds}, 上下文补充轮次 ${state.contextEnrichmentRounds}`,
    '请调用一个最合适的工具。'
  ].join('\n\n')

  return { system, user }
}

export const buildHostFinalAnswer = async (
  ctx: AiRunContext,
  state: AiRunState
): Promise<string> => {
  ctx.checkCancelled()
  const planText = buildPlanText(state.plan || [])
  const evidenceText = formatLines(state.contextEvidence || [])
  try {
    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.2 })
    const res = await model.invoke([
      new SystemMessage(
        '你是桌面 AI 运行时中的 host。请基于用户输入、证据、执行结果输出简洁、直接、可执行的最终回复。'
      ),
      new HumanMessage(
        [
          `用户输入:\n${state.input}`,
          `证据摘要:\n${evidenceText}`,
          `计划执行情况:\n${planText}`,
          `已知结论:\n${String(state.outputText || '').trim() || '无'}`,
          '请直接给最终答复。'
        ].join('\n\n')
      )
    ])
    const text = getMessageText(res.content).trim()
    if (text) return text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.toLowerCase().includes('cancel')) throw err
  }

  return String(state.outputText || '').trim() || '已完成。'
}

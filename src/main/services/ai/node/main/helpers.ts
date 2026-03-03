import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod/v4'
import { createChatModel } from '../../../llm/chatModel'
import { getMessageText } from '../../../../utils/aiCapabilityUtils'
import type { AiPlanTask } from '../../../../../shared/types'
import type { AiRunContext, AiRunState } from '../../types'

export const DEFAULT_MAX_CONTEXT_ROUNDS = 2

export const contextDecisionSchema = z.object({
  mode: z.enum(['need_context', 'to_plan', 'direct_finalize']),
  reason: z.string().optional(),
  answer: z.string().optional()
})

export const plannerTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  objective: z.string().min(1),
  kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional()
})

export const planDecisionSchema = z.object({
  tasks: z.array(plannerTaskSchema).min(1)
})

export const appendContextEvidence = (state: AiRunState, text: string): string[] => {
  // 证据做去重+长度裁剪，避免上下文随着循环无界膨胀。
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return state.contextEvidence
  if (state.contextEvidence.includes(normalized)) return state.contextEvidence
  return [...state.contextEvidence, normalized].slice(-24)
}

export const toPlanTasks = (tasks: readonly z.infer<typeof plannerTaskSchema>[]): AiPlanTask[] => {
  return tasks.map((task, index) => ({
    id: String(task.id || `task-${index + 1}`),
    title: String(task.title || `Task ${index + 1}`),
    objective: task.objective,
    kindHint: task.kindHint,
    status: 'pending',
    attempts: 0
  }))
}

export const pickPendingTaskIndex = (plan: AiPlanTask[], cursor = 0): number => {
  for (let i = Math.max(0, cursor); i < plan.length; i += 1) {
    if (plan[i].status === 'pending') return i
  }
  for (let i = 0; i < Math.max(0, cursor); i += 1) {
    if (plan[i].status === 'pending') return i
  }
  return -1
}

export const buildFinalAnswer = async (ctx: AiRunContext, state: AiRunState): Promise<string> => {
  if (state.directAnswerDraft && !state.error) {
    return state.directAnswerDraft
  }

  const taskSummary = state.plan
    .map((task) =>
      [task.title, task.status, task.resultMessage || task.error || '']
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n')
  const evidenceText = state.contextEvidence.join('\n')

  try {
    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.2 })
    const res = await model.invoke([
      new SystemMessage('你是 main graph 的 finalize 节点。请给出最终答复。'),
      new HumanMessage(
        [
          `用户输入:\n${state.input}`,
          `上下文证据:\n${evidenceText || '(none)'}`,
          `任务执行摘要:\n${taskSummary || '(none)'}`,
          `已知输出:\n${String(state.outputText || '').trim() || '(none)'}`,
          '请输出简洁、可执行、中文最终答复。'
        ].join('\n\n')
      )
    ])
    const text = getMessageText(res.content).trim()
    if (text) return text
  } catch {
    // ignore and fallback
  }

  return String(state.outputText || '').trim() || '已完成。'
}

import { z } from 'zod/v4'
import type { AiPlanTask } from '../../../../../shared/types'
import type { AiRunState } from '../../types'

export const DEFAULT_MAX_CONTEXT_ROUNDS = 2

export const contextDecisionSchema = z.object({
  mode: z.enum(['need_context', 'to_plan', 'direct_finalize']),
  reason: z.string().optional(),
  answer: z.string().optional()
})

export const plannerTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  objective: z.string().min(1)
})

export const planDecisionSchema = z.object({
  tasks: z.array(plannerTaskSchema).min(1)
})

export const appendContextEvidence = (state: AiRunState, text: string): string[] => {
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

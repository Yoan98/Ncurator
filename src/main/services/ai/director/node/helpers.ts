import { z } from 'zod/v4'
import type { AiPlanTask } from '../../../../../shared/types'
import type { AiRunState, DirectorNodeContext } from '../../types'

export const DEFAULT_MAX_CONTEXT_ROUNDS = 2
const DIRECTOR_HISTORY_LIMITS = {
  recentTurns: 12,
  maxRecentTurnsChars: 4000,
  maxSummaryChars: 1000
} as const

export const contextDecisionSchema = z.object({
  mode: z.enum(['need_context', 'to_plan', 'direct_human']),
  reason: z.string().default('')
})

export const plannerTaskSchema = z.object({
  id: z.string().default(''),
  title: z.string().default(''),
  userInput: z.string().min(1)
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

export const loadDirectorHistory = (ctx: Pick<DirectorNodeContext, 'loadHistory'>) =>
  ctx.loadHistory(DIRECTOR_HISTORY_LIMITS)

export const validatePlannerTasks = (
  tasks: readonly z.infer<typeof plannerTaskSchema>[]
): string | undefined => {
  if (tasks.length === 0) {
    return 'tasks: at least one task is required'
  }

  for (const [index, task] of tasks.entries()) {
    const userInput = String(task.userInput || '').trim()

    if (!userInput) {
      return `tasks[${index}].userInput: empty`
    }
  }

  return undefined
}

export const toPlanTasks = (tasks: readonly z.infer<typeof plannerTaskSchema>[]): AiPlanTask[] => {
  return tasks.map((task, index) => ({
    id: String(task.id || `task-${index + 1}`),
    title: String(task.title || `Task ${index + 1}`),
    userInput: task.userInput,
    status: 'ready'
  }))
}

export const pickPendingTaskIndex = (plan: AiPlanTask[], cursor = 0): number => {
  for (let i = Math.max(0, cursor); i < plan.length; i += 1) {
    if (plan[i].status === 'ready') return i
  }
  for (let i = 0; i < Math.max(0, cursor); i += 1) {
    if (plan[i].status === 'ready') return i
  }
  return -1
}

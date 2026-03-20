import { z } from 'zod/v4'
import type { AiPlanTask } from '../../../../../shared/types'
import type { AiRunState } from '../../types'

export const DEFAULT_MAX_CONTEXT_ROUNDS = 2

export const contextDecisionSchema = z.object({
  mode: z.enum(['need_context', 'to_plan', 'direct_human']),
  reason: z.string().optional()
})

export const plannerTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
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

const FINAL_SUMMARY_PATTERNS = [
  /最终答复/,
  /最终总结/,
  /总结答复/,
  /汇总(?:全部|当前)?(?:任务|交付|结果)?(?:并)?(?:输出)?(?:最终答复|最终总结|总结答复)/,
  /\bsynthesis\b/i,
  /\bfinal answer\b/i,
  /\bfinal response\b/i
]

const GENERIC_OBJECTIVE_PATTERNS = [
  /^继续(?:优化|分析|处理|推进)/,
  /^进一步(?:优化|分析|处理|推进)/,
  /^优化(?:文档|内容|质量|方案|流程)/,
  /^分析(?:问题|情况|结果|风险)$/,
  /^处理(?:任务|问题|内容)$/,
  /^总结(?:情况|结果)$/,
  /^继续任务$/
]

const normalizePlannerText = (value: string | undefined): string => String(value || '').trim()

const isFinalSummaryTask = (input: { title?: string; userInput: string }): boolean => {
  const text = [normalizePlannerText(input.title), normalizePlannerText(input.userInput)]
    .filter(Boolean)
    .join('\n')
  return FINAL_SUMMARY_PATTERNS.some((pattern) => pattern.test(text))
}

const isGenericUserInput = (userInput: string): boolean => {
  const normalized = normalizePlannerText(userInput).replace(/\s+/g, '')
  if (!normalized) return true
  if (normalized.length < 8) return true
  return GENERIC_OBJECTIVE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export const validatePlannerTasks = (
  tasks: readonly z.infer<typeof plannerTaskSchema>[]
): string | undefined => {
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    if (isFinalSummaryTask(task)) {
      return `tasks.${index}.userInput: planner must not create final summary task`
    }
    if (isGenericUserInput(task.userInput)) {
      return `tasks.${index}.userInput: userInput must be concrete and verifiable`
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

export const DIRECTOR_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const

export const AI_DIRECTOR_STAGES = [
  'director_intent',
  'director_context_human',
  'director_plan',
  'director_plan_exec',
  'director_direct_human_exec',
  'director_synthesis_human',
  'director_complete'
] as const

export const PLAN_TASK_STATUSES = ['ready', 'running', 'completed', 'blocked'] as const

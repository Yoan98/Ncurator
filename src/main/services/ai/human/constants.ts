import { SKILL_METADATA } from './skillMetadata'

export const AI_TOOL_FAMILY_IDS = ['terminal', 'kb', 'docx'] as const

const runtimeSkillIds = Object.keys(SKILL_METADATA) as Array<keyof typeof SKILL_METADATA>

export const RUNTIME_SKILL_IDS = runtimeSkillIds as [
  keyof typeof SKILL_METADATA,
  ...(keyof typeof SKILL_METADATA)[]
]

export const HUMAN_STAGES = ['brain', 'learning', 'hand', 'mouth'] as const
export const HUMAN_STATUSES = ['running', 'completed', 'blocked'] as const
export const HUMAN_FINAL_STATUSES = ['completed', 'blocked'] as const

export const HUMAN_STEP_ACTIONS = [
  'brain_decision',
  'learn_skill',
  'call_tool',
  'deliver_result',
  'block_result'
] as const

export const HUMAN_STEP_RESULT_STATUSES = ['ok', 'error', 'blocked'] as const

export const TOOL_CALL_RESULT_CODES = [
  'ok',
  'failed',
  'workspace_required',
  'approval_denied',
  'invalid_input'
] as const

export const HUMAN_DELIVERY_MODES = ['user_answer', 'task_handoff', 'context_note'] as const

export const HUMAN_MAX_BRAIN_DECISION_HISTORY = 10
export const HUMAN_DEFAULT_TOOL_CALL_LIMIT = 50

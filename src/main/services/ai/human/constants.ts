export const AI_TOOL_FAMILY_IDS = ['terminal', 'kb', 'docx', 'internal'] as const

export const BUILTIN_RUNTIME_SKILL_IDS = ['history-recall'] as const

export const EXTERNAL_RUNTIME_SKILL_IDS = [
  'workspace-cli',
  'docx-read',
  'docx-write',
  'docx-delivery',
  'kb-document-discovery',
  'kb-evidence-query'
] as const

export const LEARNABLE_RUNTIME_SKILL_IDS = EXTERNAL_RUNTIME_SKILL_IDS

export const RUNTIME_SKILL_IDS = [
  ...BUILTIN_RUNTIME_SKILL_IDS,
  ...EXTERNAL_RUNTIME_SKILL_IDS
] as const

export const HUMAN_SKILL_SOURCES = ['builtin', 'external'] as const
export const HUMAN_SKILL_AVAILABILITIES = ['always_on', 'learnable'] as const

export const HUMAN_STAGES = ['brain', 'learning', 'hand', 'mouth'] as const
export const HUMAN_STATUSES = ['running', 'completed'] as const

export const HUMAN_STEP_ACTIONS = [
  'brain_decision',
  'learn_skill',
  'call_tool',
  'deliver_result'
] as const

export const HUMAN_STEP_RESULT_STATUSES = ['ok', 'error'] as const

export const TOOL_CALL_RESULT_CODES = [
  'ok',
  'failed',
  'workspace_required',
  'approval_denied',
  'invalid_input'
] as const

export const TOOL_CALL_DIAGNOSTIC_KINDS = [
  'workspace_required',
  'invalid_input',
  'approval_denied',
  'path_unavailable'
] as const

export const HUMAN_DELIVERY_MODES = ['user_answer', 'task_handoff', 'context_note'] as const
export const HUMAN_TOOL_USE_PLAN_MODES = ['parallel', 'serial'] as const
export const HUMAN_HAND_PLAN_INVALID_REASONS = [
  'parallel_requires_read_only',
  'parallel_limit_exceeded'
] as const
export const HUMAN_WATCH_HINT_CODES = [
  'learning_no_effect',
  'learning_tool_budget_exceeded',
  'hand_plan_invalid',
  'hand_tool_limit_exceeded',
  'brain_invalid_mouth_transition'
] as const

export const HUMAN_MAX_ACTIVE_TOOLS = 20
export const HUMAN_DEFAULT_TOOL_CALL_LIMIT = 50
export const HUMAN_ROUND_EXECUTION_KINDS = [
  'pre_execution_blocked',
  'learning',
  'hand',
  'mouth'
] as const
export const HUMAN_MAX_ROUND_HISTORY = 12
export const HUMAN_MAX_HISTORY_CHAIN_ITEMS = 5
export const HUMAN_MAX_LOADED_HISTORY_ROUNDS = 3

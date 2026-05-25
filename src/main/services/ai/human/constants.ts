export const AI_TOOL_FAMILY_IDS = ['terminal', 'kb', 'docx'] as const

export const BUILTIN_RUNTIME_SKILL_IDS = ['terminal', 'kb-retrieval'] as const

export const EXTERNAL_RUNTIME_SKILL_IDS = ['docx-read', 'docx-write'] as const

export const LEARNABLE_RUNTIME_SKILL_IDS = EXTERNAL_RUNTIME_SKILL_IDS

export const RUNTIME_SKILL_IDS = [
  ...BUILTIN_RUNTIME_SKILL_IDS,
  ...EXTERNAL_RUNTIME_SKILL_IDS
] as const

export const HUMAN_SKILL_SOURCES = ['builtin', 'external'] as const

export const HUMAN_STAGES = [
  'brain',
  'learning',
  'hand',
  'mouth',
  'context_budget',
  'context_compaction'
] as const
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
  'invalid_input',
  'result_too_large'
] as const

export const HUMAN_DECISION_HINT_CODES = [
  'learning_no_effect',
  'terminal_approval_blocked',
  'hand_call_limit_exceeded',
  'hand_docx_single_file_write_limit_exceeded',
  'hand_tool_limit_exceeded',
  'hand_tool_result_too_large',
  'hand_docx_positioned_write_blocked',
  'brain_todolist_incomplete'
] as const

export const HUMAN_MAX_ACTIVE_TOOLS = 20
export const HUMAN_DEFAULT_TOOL_CALL_LIMIT = 40
export const HUMAN_HAND_CALL_LIMIT = 5
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACTION_TARGET_RATIO = 0.25
export const HUMAN_ROUND_EXECUTION_KINDS = [
  'pre_execution_blocked',
  'learning',
  'hand',
  'mouth'
] as const
export const HUMAN_MAX_ROUND_HISTORY = 100
export const HUMAN_MAX_RECENT_HISTORY_ROUNDS = 20

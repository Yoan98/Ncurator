export const AI_TOOL_FAMILY_IDS = ['terminal', 'kb', 'docx'] as const

export const BUILTIN_RUNTIME_SKILL_IDS = [
  'terminal',
  'kb-retrieval'
] as const

export const EXTERNAL_RUNTIME_SKILL_IDS = ['docx-read', 'docx-write'] as const

export const LEARNABLE_RUNTIME_SKILL_IDS = EXTERNAL_RUNTIME_SKILL_IDS

export const RUNTIME_SKILL_IDS = [
  ...BUILTIN_RUNTIME_SKILL_IDS,
  ...EXTERNAL_RUNTIME_SKILL_IDS
] as const

export const HUMAN_SKILL_SOURCES = ['builtin', 'external'] as const

export const HUMAN_STAGES = ['brain', 'learning', 'hand', 'mouth', 'context_budget', 'memory_compaction'] as const
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

export const HUMAN_TOOL_USE_PLAN_MODES = ['parallel', 'serial'] as const
export const HUMAN_HAND_PLAN_INVALID_REASONS = [
  'tool_use_plan_limit_exceeded',
  'parallel_requires_read_only',
  'parallel_limit_exceeded',
  'docx_batch_write_limit_exceeded'
] as const
export const HUMAN_WATCH_HINT_CODES = [
  'learning_no_effect',
  'learning_builtin_skill_requested',
  'learning_tool_budget_exceeded',
  'hand_plan_invalid',
  'hand_tool_limit_exceeded',
  'hand_docx_positioned_write_blocked',
  'hand_docx_batch_write_halted',
  'docx_write_requires_readback',
  'brain_todolist_incomplete'
] as const

export const HUMAN_MAX_ACTIVE_TOOLS = 20
export const HUMAN_DEFAULT_TOOL_CALL_LIMIT = 40
export const HUMAN_MAX_PARALLEL_TOOL_CALLS = 6
export const HUMAN_DOCX_BATCH_WRITE_LIMIT = 3
export const HUMAN_TOOL_USE_PLAN_LIMIT = 3
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

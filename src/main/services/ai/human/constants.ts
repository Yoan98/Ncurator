export const RUNTIME_SKILL_IDS = [
  'workspace-cli',
  'docx-read',
  'docx-write',
  'docx-delivery',
  'kb-document-discovery',
  'kb-evidence-query'
] as const

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

export const HUMAN_MAX_BRAIN_DECISION_HISTORY = 10
export const HUMAN_DEFAULT_TOOL_CALL_LIMIT = 50

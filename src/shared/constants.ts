export const RUNTIME_SKILL_IDS = [
  'workspace-shell',
  'docx-editing',
  'local-kb-retrieval'
] as const

export const RUNTIME_SKILL_REQUIREMENTS = ['workspace', 'approval', 'document_scope'] as const

export const HUMAN_STEP_ACTIONS = [
  'load_skill',
  'invoke_tool',
  'complete_task',
  'block_task'
] as const

export const HUMAN_STEP_RESULT_STATUSES = ['ok', 'error', 'blocked'] as const

export { AI_TOOL_FAMILY_IDS, RUNTIME_SKILL_IDS } from '../../../../shared/runtimeCapabilities'

export const HUMAN_SKILL_SOURCES = ['builtin', 'external'] as const

export const HUMAN_STAGES = [
  'brain',
  'dispatch',
  'learning',
  'plan',
  'hand',
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

export const HUMAN_MAX_ACTIVE_TOOLS = 30
export const HUMAN_GRAPH_RECURSION_LIMIT = 400
// 默认按 200k 上下文窗口估算，压缩阈值由 CONTEXT_COMPACTION_TRIGGER_RATIO 控制。
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACTION_TARGET_RATIO = 0.25
export const CONTEXT_COMPACTION_MIN_SOURCE_RATIO = 0.1
export const HUMAN_ROUND_EXECUTION_KINDS = ['learning', 'hand'] as const

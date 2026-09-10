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

export const HUMAN_MAX_ACTIVE_TOOLS = 25
export const HUMAN_GRAPH_RECURSION_LIMIT = 400
// 默认 256k 窗口；触发线为窗口的 80%；tail 为触发线的 10%。
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 256_000
export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACTION_TAIL_RATIO = 0.1
export const CONTEXT_SCOPE_DECISION_RATIO = 0.2
export const RUN_DIGEST_MAX_ENTRIES = 30
export const RUN_DIGEST_MAX_FILE_PATHS = 3
export const HUMAN_ROUND_EXECUTION_KINDS = ['learning', 'hand'] as const

export const resolveContextWindowTokens = (override?: number): number => {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override)
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
}

export const resolveCompactionTriggerTokens = (windowTokens: number): number =>
  Math.floor(windowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO)

export const resolveCompactionTailTokens = (windowTokens: number): number =>
  Math.floor(resolveCompactionTriggerTokens(windowTokens) * CONTEXT_COMPACTION_TAIL_RATIO)

export const resolveContextScopeDecisionTokens = (windowTokens: number): number =>
  Math.floor(windowTokens * CONTEXT_SCOPE_DECISION_RATIO)

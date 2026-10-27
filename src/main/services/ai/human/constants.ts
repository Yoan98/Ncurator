export { AI_TOOL_FAMILY_IDS, RUNTIME_TOOLSET_IDS } from '../../../../shared/runtimeCapabilities'

export const HUMAN_TOOLSET_SOURCES = ['builtin', 'external'] as const

export const HUMAN_STAGES = [
  'brain',
  'dispatch',
  'toolset_loading',
  'skill_loading',
  'plan',
  'hand',
  'interaction',
  'context_budget',
  'context_compaction'
] as const
export const HUMAN_STATUSES = ['running', 'completed', 'yielded'] as const

export const HUMAN_STEP_ACTIONS = [
  'brain_decision',
  'load_toolset',
  'load_skill',
  'call_tool',
  'deliver_result'
] as const

export const HUMAN_STEP_RESULT_STATUSES = ['ok', 'error'] as const

export const HUMAN_MAX_ACTIVE_TOOLS = 30
export const HUMAN_GRAPH_RECURSION_LIMIT = 800
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 256_000
export const CONTEXT_WINDOW_UTILIZATION_RATIO = 0.8
export const CONTEXT_COMPACTION_TAIL_RATIO = 0.1
export const HUMAN_ROUND_EXECUTION_KINDS = ['toolset_loading', 'skill_loading', 'hand'] as const

export const resolveModelContextTokens = (override?: number): number => {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override)
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
}

export const resolveEffectiveContextWindowTokens = (modelContextTokens?: number): number => {
  const modelContext = resolveModelContextTokens(modelContextTokens)
  return Math.min(
    DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    Math.floor(modelContext * CONTEXT_WINDOW_UTILIZATION_RATIO)
  )
}

export const resolveCompactionTailTokens = (effectiveWindowTokens: number): number =>
  Math.floor(effectiveWindowTokens * CONTEXT_COMPACTION_TAIL_RATIO)

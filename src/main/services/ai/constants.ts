export const AI_RUN_STATUSES = ['running', 'continued', 'completed', 'failed', 'cancelled'] as const
export const AI_LLM_CALL_TIMEOUT_MS = 300_000
/** Max automatic retries after the first LLM failure (UI: 正在重试 n/5). */
export const AI_LLM_CALL_MAX_RETRY_ATTEMPTS = 5

export const JSON_ONLY_INTENT_CONTRACT =
  '只输出 JSON，格式: {"mode":"...","reason":"...","answer":"..."}。当 mode=direct_finalize 时，必须提供 answer。'

export const JSON_ONLY_PLAN_CONTRACT = '只输出 JSON，格式: {"tasks":[{"id","title","objective"}]}。'

export const HUMAN_TOOL_ONLY_CONTRACT = [
  '你每一步必须且只能发起一次 tool call。',
  '可用工具包含 capability tools 与控制工具 complete_task/block_task。',
  '禁止直接输出自然语言结论，不允许无工具步骤。'
].join('\n')

export const FINALIZE_OUTPUT_CONTRACT = '请输出简洁、可执行、中文最终答复。'

export const SESSION_MEMORY_OUTPUT_CONTRACT = [
  'Return JSON only with keys:',
  'summary, openTasks, userPrefs, pinnedFacts, linkedDocumentIds.'
].join('\n')

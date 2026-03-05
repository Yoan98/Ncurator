export const JSON_ONLY_INTENT_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"mode":"need_context|to_plan|direct_finalize","reason":"string","answer":"string"}。',
  '规则：mode 必填；reason 必填；当 mode=direct_finalize 时 answer 必须为非空字符串；其他模式 answer 必须为空字符串。'
].join('\n')

export const JSON_ONLY_PLAN_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"tasks":[{"id":"string","title":"string","objective":"string"}]}。',
  '规则：tasks 至少 1 项；每个 objective 必须是单一任务目标，且可执行、可验证。'
].join('\n')

export const HUMAN_TOOL_ONLY_CONTRACT = [
  '你每一步必须且只能发起一次工具调用（一次 tool call）。',
  '你只能调用当前已绑定工具（业务工具 + complete_task + block_task）。',
  '禁止直接输出自然语言结论。',
  '目标完成时调用 complete_task；无法继续时调用 block_task。'
].join('\n')

export const FINALIZE_OUTPUT_CONTRACT = [
  '输出中文最终答复，顺序固定：结论 -> 已完成项 -> 关键依据 -> 未完成/待确认 -> 下一步建议（可选）。',
  '不得编造事实；证据不足时必须明确标注“待确认”。',
  '禁止暴露内部实现术语（如 graph/node/tool_call 等）。'
].join('\n')

export const SESSION_MEMORY_OUTPUT_CONTRACT = [
  '只输出 JSON，不得输出额外文字。',
  '键名必须且只能是：summary, openTasks, userPrefs, pinnedFacts, linkedDocumentIds。',
  'summary 为字符串；其余字段为字符串数组；数组元素使用简短短语。'
].join('\n')

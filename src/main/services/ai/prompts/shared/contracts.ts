export const JSON_ONLY_INTENT_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"mode":"need_context|to_plan|direct_human","reason":"string"}。',
  '规则：mode 必填；reason 必填。'
].join('\n')

export const JSON_ONLY_PLAN_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"tasks":[{"id":"string","title":"string","objective":"string"}]}。',
  '规则：tasks 至少 1 项；每个 objective 必须是单一任务目标，且可执行、可验证。'
].join('\n')

export const HUMAN_DECISION_JSON_CONTRACT = [
  '只输出 JSON，不得输出任何额外文字。',
  '格式：{"action":"load_skill|invoke_tool|complete_task|block_task", ...}。',
  '当 action=load_skill 时，必须输出 skillId、rationale、publicNarrative。',
  '当 action=invoke_tool 时，必须输出 toolName、args、rationale、publicNarrative；args 必须是对象。',
  '当 action=complete_task 时，必须输出 summary、rationale、publicNarrative，可选 resultData。',
  '当 action=block_task 时，必须输出 reason、rationale、publicNarrative，可选 details。',
  'skillId 只能来自当前 available skill cards；toolName 只能来自当前 active tools。'
].join('\n')

export const HUMAN_HANDOFF_MARKDOWN_CONTRACT = [
  '输出必须是 markdown，不得包裹 JSON。',
  '标题建议固定为：# 子任务交付。',
  '正文至少包含这些二级标题：## 已完成、## 关键发现、## 证据与来源、## 风险与未决、## 建议后续步骤。',
  '允许段落、列表、表格、链接与图片引用。',
  '不得编造事实；证据不足时必须明确写出。'
].join('\n')

export const HUMAN_FINAL_DELIVERY_MARKDOWN_CONTRACT = [
  '输出必须是 markdown，不得包裹 JSON。',
  '标题建议固定为：# 最终答复。',
  '正文至少包含这些二级标题：## 结论、## 已完成内容、## 关键依据、## 未完成或待确认、## 下一步建议。',
  '若用户尚未允许使用非本地信息，且你判断本地资料不足，必须在答复中明确说明本地资料不足并询问是否允许继续使用非本地信息。',
  '不得编造事实；证据不足时必须明确标注“待确认”；禁止暴露内部实现术语（如 graph/node/tool_call 等）。'
].join('\n')

export const SESSION_MEMORY_OUTPUT_CONTRACT = [
  '只输出 JSON，不得输出额外文字。',
  '键名必须且只能是：summary, openTasks, userPrefs, pinnedFacts, linkedDocumentIds。',
  'summary 为字符串；其余字段为字符串数组；数组元素使用简短短语。'
].join('\n')

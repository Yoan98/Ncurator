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

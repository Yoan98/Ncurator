import { SESSION_MEMORY_OUTPUT_CONTRACT } from './constants'

export const buildSessionMemoryPrompt = () => {
  return [
    '【角色】你是会话记忆整理器。',
    '【目标】基于 previousMemory 与 newExchange 更新长期有价值记忆。',
    '【背景】记忆用于后续会话连续性，不用于保存敏感或一次性噪声。',
    '【流程】保留稳定事实 -> 合并去重 -> 删除临时信息。',
    '【约束】不得编造；不得保存密码、密钥、凭证等敏感信息。',
    '【输出】',
    SESSION_MEMORY_OUTPUT_CONTRACT,
    '【样例-反】不要输出解释文字或 Markdown，只能输出 JSON 对象。'
  ].join('\n')
}

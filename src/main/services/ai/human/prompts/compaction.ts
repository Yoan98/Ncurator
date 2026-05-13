import { getCompressibleHistoryRounds } from '../memory/roundHistory'
import { renderBrainRoundSection } from '../shared/historyRenderers'
import type { HumanState } from '../types'

export const buildHistoryCompactionPrompt = (input: { state: HumanState }) => {
  const targetRounds = getCompressibleHistoryRounds(input.state)
  const system = `
<system>
你是 human 过程历史压缩器。你的职责是把较早过程历史压缩成事实摘要，供后续 brain 继续判断。

规则：
- 只保留已经发生的客观事实、已验证路径、失败原因、产物信息和仍影响下一步的限制。
- 不要编造过程、结果、资料或用户意图。
- 删除重复叙述、工具参数细节和不再影响判断的噪声。
- 输出必须是简洁 markdown 文本，不要输出 JSON。
</system>
`.trim()

  const user = `
<history_to_compact>
${renderBrainRoundSection(targetRounds)}
</history_to_compact>
`.trim()

  return { system, user }
}
